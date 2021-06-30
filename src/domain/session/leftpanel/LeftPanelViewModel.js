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

import {ViewModel} from "../../ViewModel.js";
import {RoomTileViewModel} from "./RoomTileViewModel.js";
import {InviteTileViewModel} from "./InviteTileViewModel.js";
import {RoomFilter} from "./RoomFilter.js";
import {ApplyMap} from "../../../observable/map/ApplyMap.js";

export class LeftPanelViewModel extends ViewModel {
    constructor(options) {
        super(options);
        const {rooms, invites} = options;
        this._tileViewModelsMap = this._mapTileViewModels(rooms, invites);
        this._tileViewModelsFilterMap = new ApplyMap(this._tileViewModelsMap);
        this._tileViewModels = this._tileViewModelsFilterMap.sortValues((a, b) => a.compare(b));
        this._currentTileVM = null;
        this._setupNavigation();
        this._closeUrl = this.urlCreator.urlForSegment("session");
        this._settingsUrl = this.urlCreator.urlForSegment("settings");
    }

    _mapTileViewModels(rooms, invites) {
        // join is not commutative, invites will take precedence over rooms
        return invites.join(rooms).mapValues((roomOrInvite, emitChange) => {
            let vm;
            if (roomOrInvite.isInvite) {
                vm = new InviteTileViewModel(this.childOptions({invite: roomOrInvite, emitChange}));
            } else {
                vm = new RoomTileViewModel(this.childOptions({room: roomOrInvite, emitChange}));
            }
            const isOpen = this.navigation.path.get("room")?.value === roomOrInvite.id;
            if (isOpen) {
                vm.open();
                this._updateCurrentVM(vm);
            }
            return vm;
        });
    }

    _updateCurrentVM(vm) {
        // need to also update the current vm here as
        // we can't call `_open` from the ctor as the map
        // is only populated when the view subscribes.
        this._currentTileVM?.close();
        this._currentTileVM = vm;
    }

    get closeUrl() {
        return this._closeUrl;
    }

    get settingsUrl() {
        return this._settingsUrl;
    }

    _setupNavigation() {
        const roomObservable = this.navigation.observe("room");
        this.track(roomObservable.subscribe(roomId => this._open(roomId)));

        const gridObservable = this.navigation.observe("rooms");
        this.gridEnabled = !!gridObservable.get();
        this.track(gridObservable.subscribe(roomIds => {
            const changed = this.gridEnabled ^ !!roomIds;
            this.gridEnabled = !!roomIds;
            if (changed) {
                this.emitChange("gridEnabled");
            }
        }));
    }

    _open(roomId) {
        this._currentTileVM?.close();
        this._currentTileVM = null;
        if (roomId) {
            this._currentTileVM = this._tileViewModelsMap.get(roomId);
            this._currentTileVM?.open();
        }
    }

    _pathForDetails(path) {
        let _path = path;
        const details = this.navigation.path.get("details");
        if (details?.value) {
            _path = _path.with(this.navigation.segment("right-panel"));
            _path = _path.with(details)
        }
        return _path;
    }

    toggleGrid() {
        const room = this.navigation.path.get("room");
        let path = this.navigation.path.until("session");
        if (this.gridEnabled) {
            if (room) {
                path = path.with(room);
                path = this._pathForDetails(path);
            }
        } else {
            if (room) {
                path = path.with(this.navigation.segment("rooms", [room.value]));
                path = path.with(room);
                path = this._pathForDetails(path);
            } else {
                path = path.with(this.navigation.segment("rooms", []));
                path = path.with(this.navigation.segment("empty-grid-tile", 0));
            }
        }
        this.navigation.applyPath(path);
    }

    get tileViewModels() {
        return this._tileViewModels;
    }

    clearFilter() {
        this._tileViewModelsFilterMap.setApply(null);
        this._tileViewModelsFilterMap.applyOnce((roomId, vm) => vm.hidden = false);
    }

    setFilter(query) {
        query = query.trim();
        if (query.length === 0) {
            this.clearFilter();
        } else {
            const filter = new RoomFilter(query);
            this._tileViewModelsFilterMap.setApply((roomId, vm) => {
                vm.hidden = !filter.matches(vm);
            });
        }
    }
}
