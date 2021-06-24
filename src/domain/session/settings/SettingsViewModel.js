/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import {ViewModel} from "../../ViewModel.js";
import {SessionBackupViewModel} from "./SessionBackupViewModel.js";

class PushNotificationStatus {
    constructor() {
        this.supported = null;
        this.enabled = false;
        this.updating = false;
        this.enabledOnServer = null;
        this.serverError = null;
    }
}

function formatKey(key) {
    const partLength = 4;
    const partCount = Math.ceil(key.length / partLength);
    let formattedKey = "";
    for (let i = 0; i < partCount; i += 1) {
        formattedKey += (formattedKey.length ? " " : "") + key.slice(i * partLength, (i + 1) * partLength);
    }
    return formattedKey;
}

export class SettingsViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._updateService = options.updateService;
        const session = options.session;
        this._session = session;
        this._sessionBackupViewModel = this.track(new SessionBackupViewModel(this.childOptions({session})));
        this._closeUrl = this.urlCreator.urlUntilSegment("session");
        this._estimate = null;

        this.sentImageSizeLimit = null;
        this.minSentImageSizeLimit = 400;
        this.maxSentImageSizeLimit = 4000;
        this.pushNotifications = new PushNotificationStatus();
    }

    setSentImageSizeLimit(size) {
        if (size > this.maxSentImageSizeLimit || size < this.minSentImageSizeLimit) {
            this.sentImageSizeLimit = null;
            this.platform.settingsStorage.remove("sentImageSizeLimit");
        } else {
            this.sentImageSizeLimit = Math.round(size);
            this.platform.settingsStorage.setInt("sentImageSizeLimit", size);
        }
        this.emitChange("sentImageSizeLimit");
    }

    async load() {
        this._estimate = await this.platform.estimateStorageUsage();
        this.sentImageSizeLimit = await this.platform.settingsStorage.getInt("sentImageSizeLimit");
        this.pushNotifications.supported = await this.platform.notificationService.supportsPush();
        this.pushNotifications.enabled = await this._session.arePushNotificationsEnabled();
        this.emitChange("");
    }

    get closeUrl() {
        return this._closeUrl;
    }

    get fingerprintKey() {
        return formatKey(this._session.fingerprintKey);
    }

    get deviceId() {
        return this._session.deviceId;
    }

    get userId() {
        return this._session.userId;
    }

    get version() {
        const {updateService} = this.platform; 
        if (updateService) {
            return `${updateService.version} (${updateService.buildHash})`;
        }
        return this.i18n`development version`;
    }

    checkForUpdate() {
        this.platform.updateService?.checkForUpdate();
    }

    get showUpdateButton() {
        return !!this.platform.updateService;
    }

    get sessionBackupViewModel() {
        return this._sessionBackupViewModel;
    }

    get storageQuota() {
        return this._formatBytes(this._estimate?.quota);
    }

    get storageUsage() {
        return this._formatBytes(this._estimate?.usage);
    }

    _formatBytes(n) {
        if (typeof n === "number") {
            return Math.round(n / (1024 * 1024)).toFixed(1) + " MB";
        } else {
            return this.i18n`unknown`;
        }
    }

    async exportLogs() {
        const logExport = await this.logger.export();
        this.platform.saveFileAs(logExport.asBlob(), `hydrogen-logs-${this.platform.clock.now()}.json`);
    }

    async togglePushNotifications() {
        this.pushNotifications.updating = true;
        this.pushNotifications.enabledOnServer = null;
        this.pushNotifications.serverError = null;
        this.emitChange("pushNotifications.updating");
        try {
            if (await this._session.enablePushNotifications(!this.pushNotifications.enabled)) {
                this.pushNotifications.enabled = !this.pushNotifications.enabled;
                if (this.pushNotifications.enabled) {
                    this.platform.notificationService.showNotification(this.i18n`Push notifications are now enabled`);
                }
            }
        } finally {
        this.pushNotifications.updating = false;
            this.emitChange("pushNotifications.updating");
        }
    }

    async checkPushEnabledOnServer() {
        this.pushNotifications.enabledOnServer = null;
        this.pushNotifications.serverError = null;
        try {
            this.pushNotifications.enabledOnServer = await this._session.checkPusherEnabledOnHomeServer();
            this.emitChange("pushNotifications.enabledOnServer");
        } catch (err) {
            this.pushNotifications.serverError = err;
            this.emitChange("pushNotifications.serverError");
        }
    }

    get themes() {
        return this.platform.themeManager.themes;
    }

    get currentThemeName() {
        return this.platform.themeManager.currentThemeName;
    }

    async setTheme(name) {
        const vm = this;
        return new Promise(resolve => {
            vm.platform.themeManager.setTheme(name).then(() => {
                vm.platform.settingsStorage.setString("theme", name);
                vm.emitChange("currentThemeName");
                resolve();
            });
        });
    }
}

