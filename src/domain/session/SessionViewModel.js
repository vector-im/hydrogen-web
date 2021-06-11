/*
Copyright 2020 Bruno Windels <bruno@windels.cloud>
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

import {LeftPanelViewModel} from "./leftpanel/LeftPanelViewModel.js";
import {RoomViewModel} from "./room/RoomViewModel.js";
import {RoomDetailsViewModel} from "./rightpanel/RoomDetailsViewModel.js";
import {UnknownRoomViewModel} from "./room/UnknownRoomViewModel.js";
import {InviteViewModel} from "./room/InviteViewModel.js";
import {LightboxViewModel} from "./room/LightboxViewModel.js";
import {SessionStatusViewModel} from "./SessionStatusViewModel.js";
import {RoomGridViewModel} from "./RoomGridViewModel.js";
import {SettingsViewModel} from "./settings/SettingsViewModel.js";
import {ViewModel} from "../ViewModel.js";
import {RoomViewModelObservable} from "./RoomViewModelObservable.js";
import {MemberListViewModel} from "./rightpanel/MemberListViewModel.js";

export class SessionViewModel extends ViewModel {
    constructor(options) {
        super(options);
        const {sessionContainer} = options;
        this._sessionContainer = this.track(sessionContainer);
        this._sessionStatusViewModel = this.track(new SessionStatusViewModel(this.childOptions({
            sync: sessionContainer.sync,
            reconnector: sessionContainer.reconnector,
            session: sessionContainer.session,
        })));
        this._leftPanelViewModel = this.track(new LeftPanelViewModel(this.childOptions({
            invites: this._sessionContainer.session.invites,
            rooms: this._sessionContainer.session.rooms
        })));
        this._settingsViewModel = null;
        this._roomViewModelObservable = null;
        this._gridViewModel = null;
        this._setupNavigation();
    }

    _setupNavigation() {
        const gridRooms = this.navigation.observe("rooms");
        // this gives us a set of room ids in the grid
        this.track(gridRooms.subscribe(roomIds => {
            this._updateGrid(roomIds);
        }));
        if (gridRooms.get()) {
            this._updateGrid(gridRooms.get());
        }

        const currentRoomId = this.navigation.observe("room");
        // this gives us the active room
        this.track(currentRoomId.subscribe(roomId => {
            if (!this._gridViewModel) {
                this._updateRoom(roomId);
            }
            this._updateRoomDetails();
        }));
        if (!this._gridViewModel) {
            this._updateRoom(currentRoomId.get());
        }

        const settings = this.navigation.observe("settings");
        this.track(settings.subscribe(settingsOpen => {
            this._updateSettings(settingsOpen);
        }));
        this._updateSettings(settings.get());

        const lightbox = this.navigation.observe("lightbox");
        this.track(lightbox.subscribe(eventId => {
            this._updateLightbox(eventId);
        }));
        this._updateLightbox(lightbox.get());

        const details = this.navigation.observe("details");
        this.track(details.subscribe(() => this._updateRoomDetails()));
        this._updateRoomDetails();

        const members = this.navigation.observe("members");
        this.track(members.subscribe(() => this._toggleMemberListPanel()));
        this._toggleMemberListPanel();
    }

    get id() {
        return this._sessionContainer.sessionId;
    }

    start() {
        this._sessionStatusViewModel.start();
    }

    get activeMiddleViewModel() {
        return this._roomViewModelObservable?.get() || this._gridViewModel || this._settingsViewModel;
    }

    get roomGridViewModel() {
        return this._gridViewModel;
    }

    get leftPanelViewModel() {
        return this._leftPanelViewModel;
    }

    get sessionStatusViewModel() {
        return this._sessionStatusViewModel;
    }

    get settingsViewModel() {
        return this._settingsViewModel;
    }

    get currentRoomViewModel() {
        return this._roomViewModelObservable?.get();
    }

    get roomDetailsViewModel() {
        return this._roomDetailsViewModel;
    }

    get memberListViewModel() {
        return this._memberListViewModel;
    }

    _updateGrid(roomIds) {
        const changed = !(this._gridViewModel && roomIds);
        const currentRoomId = this.navigation.path.get("room");
        if (roomIds) {
            if (!this._gridViewModel) {
                this._gridViewModel = this.track(new RoomGridViewModel(this.childOptions({
                    width: 3,
                    height: 2,
                    createRoomViewModelObservable: roomId => new RoomViewModelObservable(this, roomId),
                })));
                // try to transfer the current room view model, so we don't have to reload the timeline
                this._roomViewModelObservable?.unsubscribeAll();
                if (this._gridViewModel.initializeRoomIdsAndTransferVM(roomIds, this._roomViewModelObservable)) {
                    this._roomViewModelObservable = this.untrack(this._roomViewModelObservable);
                } else if (this._roomViewModelObservable) {
                    this._roomViewModelObservable = this.disposeTracked(this._roomViewModelObservable);
                }
            } else {
                this._gridViewModel.setRoomIds(roomIds);
            }
        } else if (this._gridViewModel && !roomIds) {
            // closing grid, try to show focused room in grid
            if (currentRoomId) {
                const vmo = this._gridViewModel.releaseRoomViewModel(currentRoomId.value);
                if (vmo) {
                    this._roomViewModelObservable = this.track(vmo);
                    this._roomViewModelObservable.subscribe(() => {
                        this.emitChange("activeMiddleViewModel");
                    });
                }
            }
            this._gridViewModel = this.disposeTracked(this._gridViewModel);
        }
        if (changed) {
            this.emitChange("activeMiddleViewModel");
        }
    }

    _createRoomViewModel(roomId) {
        const room = this._sessionContainer.session.rooms.get(roomId);
        if (room) {
            const roomVM = new RoomViewModel(this.childOptions({room}));
            roomVM.load();
            return roomVM;
        }
        return null;
    }

    _createUnknownRoomViewModel(roomIdOrAlias) {
        return new UnknownRoomViewModel(this.childOptions({
            roomIdOrAlias,
            session: this._sessionContainer.session,
        }));
    }

    async _createArchivedRoomViewModel(roomId) {
        const room = await this._sessionContainer.session.loadArchivedRoom(roomId);
        if (room) {
            const roomVM = new RoomViewModel(this.childOptions({room}));
            roomVM.load();
            return roomVM;
        }
        return null;
    }

    _createInviteViewModel(roomId) {
        const invite = this._sessionContainer.session.invites.get(roomId);
        if (invite) {
            return new InviteViewModel(this.childOptions({
                invite,
                mediaRepository: this._sessionContainer.session.mediaRepository,
            }));
        }
        return null;
    }

    _updateRoom(roomId) {
        // opening a room and already open?
        if (this._roomViewModelObservable?.id === roomId) {
            return;
        }
        // close if needed
        if (this._roomViewModelObservable) {
            this._roomViewModelObservable = this.disposeTracked(this._roomViewModelObservable);
        }
        if (!roomId) {
            // if clearing the activeMiddleViewModel rather than changing to a different one,
            // emit so the view picks it up and show the placeholder
            this.emitChange("activeMiddleViewModel");
            return;
        }
        const vmo = new RoomViewModelObservable(this, roomId);
        this._roomViewModelObservable = this.track(vmo);
        // subscription is unsubscribed in RoomViewModelObservable.dispose, and thus handled by track
        this._roomViewModelObservable.subscribe(() => {
            this.emitChange("activeMiddleViewModel");
        });
        vmo.initialize();
    }

    _updateSettings(settingsOpen) {
        if (this._settingsViewModel) {
            this._settingsViewModel = this.disposeTracked(this._settingsViewModel);
        }
        if (settingsOpen) {
            this._settingsViewModel = this.track(new SettingsViewModel(this.childOptions({
                session: this._sessionContainer.session,
            })));
            this._settingsViewModel.load();
        }
        this.emitChange("activeMiddleViewModel");
    }

    _updateLightbox(eventId) {
        if (this._lightboxViewModel) {
            this._lightboxViewModel = this.disposeTracked(this._lightboxViewModel);
        }
        if (eventId) {
            const room = this._roomFromNavigation();
            this._lightboxViewModel = this.track(new LightboxViewModel(this.childOptions({eventId, room})));
        }
        this.emitChange("lightboxViewModel");
    }

    get lightboxViewModel() {
        return this._lightboxViewModel;
    }

    _roomFromNavigation() {
        const roomId = this.navigation.path.get("room")?.value;
        const room = this._sessionContainer.session.rooms.get(roomId);
        return room;
    }

    _updateRoomDetails() {
        this._roomDetailsViewModel = this.disposeTracked(this._roomDetailsViewModel);
        const enable = !!this.navigation.path.get("details")?.value;
        if (enable) {
            const room = this._roomFromNavigation();
            if (!room) { return; }
            this._roomDetailsViewModel = this.track(new RoomDetailsViewModel(this.childOptions({room})));
        }
        this.emitChange("roomDetailsViewModel");
    }

    async _toggleMemberListPanel() {
        this._memberListViewModel = this.disposeTracked(this._memberListViewModel);
        const enable = !!this.navigation.path.get("members")?.value;
        if (enable) {
            const room = this._roomFromNavigation();
            const list = await room.loadMemberList();
            const members = list.members;
            this._memberListViewModel = this.track(
                new MemberListViewModel(this.childOptions({members}))
            );
        }
        this.emitChange("memberListViewModel");
    }
}
