/*
Copyright 2020 Bruno Windels <bruno@windels.cloud>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import {SessionViewModel} from "./session/SessionViewModel.js";
import {SessionLoadViewModel} from "./SessionLoadViewModel.js";
import {LoginViewModel} from "./LoginViewModel.js";
import {SessionPickerViewModel} from "./SessionPickerViewModel.js";
import {ViewModel} from "./ViewModel.js";

export class RootViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._createSessionContainer = options.createSessionContainer;
        this._error = null;
        this._sessionPickerViewModel = null;
        this._sessionLoadViewModel = null;
        this._loginViewModel = null;
        this._sessionViewModel = null;
        this._pendingSessionContainer = null;
    }

    async load() {
        this.platform.themeManager.setTheme(await this.platform.settingsStorage.getString("theme"));
        this.track(this.navigation.observe("login").subscribe(() => this._applyNavigation()));
        this.track(this.navigation.observe("session").subscribe(() => this._applyNavigation()));
        this._applyNavigation(true);
    }

    async _applyNavigation(shouldRestoreLastUrl) {
        const isLogin = this.navigation.observe("login").get();
        const sessionId = this.navigation.observe("session").get();
        if (isLogin) {
            if (this.activeSection !== "login") {
                this._showLogin();
            }
        } else if (sessionId === true) {
            if (this.activeSection !== "picker") {
                this._showPicker();
            }
        } else if (sessionId) {
            if (!this._sessionViewModel || this._sessionViewModel.id !== sessionId) {
                // see _showLogin for where _pendingSessionContainer comes from
                if (this._pendingSessionContainer && this._pendingSessionContainer.sessionId === sessionId) {
                    const sessionContainer = this._pendingSessionContainer;
                    this._pendingSessionContainer = null;
                    this._showSession(sessionContainer);
                } else {
                    // this should never happen, but we want to be sure not to leak it
                    if (this._pendingSessionContainer) {
                        this._pendingSessionContainer.dispose();
                        this._pendingSessionContainer = null;
                    }
                    this._showSessionLoader(sessionId);
                }
            }
        } else {
            try {
                if (!(shouldRestoreLastUrl && this.urlCreator.tryRestoreLastUrl())) {
                    const sessionInfos = await this.platform.sessionInfoStorage.getAll();
                    if (sessionInfos.length === 0) {
                        this.navigation.push("login");
                    } else if (sessionInfos.length === 1) {
                        this.navigation.push("session", sessionInfos[0].id);
                    } else {
                        this.navigation.push("session");
                    }
                }
            } catch (err) {
                this._setSection(() => this._error = err);
            }
        }
    }

    async _showPicker() {
        this._setSection(() => {
            this._sessionPickerViewModel = new SessionPickerViewModel(this.childOptions());
        });
        try {
            await this._sessionPickerViewModel.load();
        } catch (err) {
            this._setSection(() => this._error = err);
        }
    }

    _showLogin() {
        this._setSection(() => {
            this._loginViewModel = new LoginViewModel(this.childOptions({
                defaultHomeServer: this.platform.config["defaultHomeServer"],
                createSessionContainer: this._createSessionContainer,
                ready: sessionContainer => {
                    // we don't want to load the session container again,
                    // but we also want the change of screen to go through the navigation
                    // so we store the session container in a temporary variable that will be
                    // consumed by _applyNavigation, triggered by the navigation change
                    // 
                    // Also, we should not call _setSection before the navigation is in the correct state,
                    // as url creation (e.g. in RoomTileViewModel)
                    // won't be using the correct navigation base path.
                    this._pendingSessionContainer = sessionContainer;
                    this.navigation.push("session", sessionContainer.sessionId);
                },
            }));
        });
    }

    _showSession(sessionContainer) {
        this._setSection(() => {
            this._sessionViewModel = new SessionViewModel(this.childOptions({sessionContainer}));
            this._sessionViewModel.start();
        });
    }

    _showSessionLoader(sessionId) {
        this._setSection(() => {
            this._sessionLoadViewModel = new SessionLoadViewModel(this.childOptions({
                createAndStartSessionContainer: () => {
                    const sessionContainer = this._createSessionContainer();
                    sessionContainer.startWithExistingSession(sessionId);
                    return sessionContainer;
                },
                ready: sessionContainer => this._showSession(sessionContainer)
            }));
            this._sessionLoadViewModel.start();
        });
    }

    get activeSection() {
        if (this._error) {
            return "error";
        } else if (this._sessionViewModel) {
            return "session";
        } else if (this._loginViewModel) {
            return "login";
        } else if (this._sessionPickerViewModel) {
            return "picker";
        } else if (this._sessionLoadViewModel) {
            return "loading";
        } else {
            return "redirecting";
        }
    }

    _setSection(setter) {
        // clear all members the activeSection depends on
        this._error = null;
        this._sessionPickerViewModel = this.disposeTracked(this._sessionPickerViewModel);
        this._sessionLoadViewModel = this.disposeTracked(this._sessionLoadViewModel);
        this._loginViewModel = this.disposeTracked(this._loginViewModel);
        this._sessionViewModel = this.disposeTracked(this._sessionViewModel);
        // now set it again
        setter();
        this._sessionPickerViewModel && this.track(this._sessionPickerViewModel);
        this._sessionLoadViewModel && this.track(this._sessionLoadViewModel);
        this._loginViewModel && this.track(this._loginViewModel);
        this._sessionViewModel && this.track(this._sessionViewModel);
        this.emitChange("activeSection");
    }

    get error() { return this._error; }
    get sessionViewModel() { return this._sessionViewModel; }
    get loginViewModel() { return this._loginViewModel; }
    get sessionPickerViewModel() { return this._sessionPickerViewModel; }
    get sessionLoadViewModel() { return this._sessionLoadViewModel; }
}
