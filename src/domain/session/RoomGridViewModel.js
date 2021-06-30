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

import {ViewModel} from "../ViewModel.js";

function dedupeSparse(roomIds) {
    return roomIds.map((id, idx) => {
        if (roomIds.slice(0, idx).includes(id)) {
            return undefined;
        } else {
            return id;
        }
    });
}

export class RoomGridViewModel extends ViewModel {
    constructor(options) {
        super(options);

        this._width = options.width;
        this._height = options.height;
        this._createRoomViewModelObservable = options.createRoomViewModelObservable;
        this._selectedIndex = 0;
        this._viewModelsObservables = [];
        this._setupNavigation();
    }

    _setupNavigation() {
        const focusTileIndex = this.navigation.observe("empty-grid-tile");
        this.track(focusTileIndex.subscribe(index => {
            if (typeof index === "number") {
                this._setFocusIndex(index);
            }
        }));
        if (typeof focusTileIndex.get() === "number") {
            this._selectedIndex = focusTileIndex.get();
        }

        const focusedRoom = this.navigation.observe("room");
        this.track(focusedRoom.subscribe(roomId => {
            if (roomId) {
                // as the room will be in the "rooms" observable
                // (monitored by the parent vmo) as well,
                // we only change the focus here and trust
                // setRoomIds to have created the vmo already
                this._setFocusRoom(roomId);
            }
        }));
        // initial focus for a room is set by initializeRoomIdsAndTransferVM
    }

    roomViewModelAt(i) {
        return this._viewModelsObservables[i]?.get();
    }

    get focusIndex() {
        return this._selectedIndex;
    }

    get width() {
        return this._width;
    }

    get height() {
        return this._height;
    }

    _switchToRoom(roomId) {
        const detailsShown = !!this.navigation.path.get("details")?.value;
        let path = this.navigation.path.until("rooms");
        path = path.with(this.navigation.segment("room", roomId));
        if (detailsShown) {
            path = path.with(this.navigation.segment("right-panel", true));
            path = path.with(this.navigation.segment("details", true));
        }
        this.navigation.applyPath(path);
    }

    focusTile(index) {
        if (index === this._selectedIndex) {
            return;
        }
        const vmo = this._viewModelsObservables[index];
        if (vmo) {
            this._switchToRoom(vmo.id);
        } else {
            this.navigation.push("empty-grid-tile", index);
        }
    }

    /** called from SessionViewModel */
    initializeRoomIdsAndTransferVM(roomIds, existingRoomVM) {
        roomIds = dedupeSparse(roomIds);
        let transfered = false;
        if (existingRoomVM) {
            const index = roomIds.indexOf(existingRoomVM.id);
            if (index !== -1) {
                this._viewModelsObservables[index] = this.track(existingRoomVM);
                existingRoomVM.subscribe(viewModel => this._refreshRoomViewModel(viewModel));
                transfered = true;
            }
        }
        this.setRoomIds(roomIds);
        // now all view models exist, set the focus to the selected room
        const focusedRoom = this.navigation.path.get("room");
        if (focusedRoom) {
            const index = this._viewModelsObservables.findIndex(vmo => vmo && vmo.id === focusedRoom.value);
            if (index !== -1) {
                this._selectedIndex = index;
            }
        }
        return transfered;
    }

    /** called from SessionViewModel */
    setRoomIds(roomIds) {
        roomIds = dedupeSparse(roomIds);
        let changed = false;
        const len = this._height * this._width;
        for (let i = 0; i < len; i += 1) {
            const newId = roomIds[i];
            const vmo = this._viewModelsObservables[i];
            // did anything change?
            if ((!vmo && newId) || (vmo && vmo.id !== newId)) {
                if (vmo) {
                    this._viewModelsObservables[i] = this.disposeTracked(vmo);
                }
                if (newId) {
                    const vmo = this._createRoomViewModelObservable(newId);
                    this._viewModelsObservables[i] = this.track(vmo);
                    vmo.subscribe(viewModel => this._refreshRoomViewModel(viewModel));
                    vmo.initialize();
                }
                changed = true;
            }
        }
        if (changed) {
            this.emitChange();
        }
        return changed;
    }

    _refreshRoomViewModel(viewModel) {
        this.emitChange();
        viewModel?.focus();
    }

    /** called from SessionViewModel */
    releaseRoomViewModel(roomId) {
        const index = this._viewModelsObservables.findIndex(vmo => vmo && vmo.id === roomId);
        if (index !== -1) {
            const vmo = this._viewModelsObservables[index];
            this.untrack(vmo);
            vmo.unsubscribeAll();
            this._viewModelsObservables[index] = null;
            return vmo;
        }
    }

    _setFocusIndex(idx) {
        if (idx === this._selectedIndex || idx >= (this._width * this._height)) {
            return;
        }
        this._selectedIndex = idx;
        const vmo = this._viewModelsObservables[this._selectedIndex];
        vmo?.get()?.focus();
        this.emitChange("focusIndex");
    }

    _setFocusRoom(roomId) {
        const index = this._viewModelsObservables.findIndex(vmo => vmo?.id === roomId);
        if (index >= 0) {
            this._setFocusIndex(index);
        }
    }
}

import {createNavigation} from "../navigation/index.js";
import {ObservableValue} from "../../observable/ObservableValue.js";

export function tests() { 
    class RoomVMMock {
        constructor(id) {
            this.id = id;
            this.disposed = false;
            this.focused = false;
        }
        dispose() {
            this.disposed = true;
        }
        focus() {
            this.focused = true;
        }
    }

    class RoomViewModelObservableMock extends ObservableValue {
        async initialize() {}
        dispose() { this.get()?.dispose(); }
        get id() { return this.get()?.id; }
    }

    function createNavigationForRoom(rooms, room) {
        const navigation = createNavigation();
        navigation.applyPath(navigation.pathFrom([
            navigation.segment("session", "1"),
            navigation.segment("rooms", rooms),
            navigation.segment("room", room),
        ]));
        return navigation;
    }

    function createNavigationForEmptyTile(rooms, idx) {
        const navigation = createNavigation();
        navigation.applyPath(navigation.pathFrom([
            navigation.segment("session", "1"),
            navigation.segment("rooms", rooms),
            navigation.segment("empty-grid-tile", idx),
        ]));
        return navigation;
    }

    return {
        "initialize with duplicate set of rooms": assert => {
            const navigation = createNavigationForRoom(["c", "a", "b", undefined, "a"], "a");
            const gridVM = new RoomGridViewModel({
                createRoomViewModelObservable: id => new RoomViewModelObservableMock(new RoomVMMock(id)),
                navigation,
                width: 3,
                height: 2,
            });
            gridVM.initializeRoomIdsAndTransferVM(navigation.path.get("rooms").value);
            assert.equal(gridVM.focusIndex, 1);
            assert.equal(gridVM.roomViewModelAt(0).id, "c");
            assert.equal(gridVM.roomViewModelAt(1).id, "a");
            assert.equal(gridVM.roomViewModelAt(2).id, "b");
            assert.equal(gridVM.roomViewModelAt(3), undefined);
            assert.equal(gridVM.roomViewModelAt(4), undefined);
            assert.equal(gridVM.roomViewModelAt(5), undefined);
        },
        "transfer room view model": assert => {
            const navigation = createNavigationForRoom(["a"], "a");
            const gridVM = new RoomGridViewModel({
                createRoomViewModelObservable: () => assert.fail("no vms should be created"),
                navigation,
                width: 3,
                height: 2,
            });
            const existingRoomVM = new RoomViewModelObservableMock(new RoomVMMock("a"));
            const transfered = gridVM.initializeRoomIdsAndTransferVM(navigation.path.get("rooms").value, existingRoomVM);
            assert.equal(transfered, true);
            assert.equal(gridVM.focusIndex, 0);
            assert.equal(gridVM.roomViewModelAt(0).id, "a");
        },
        "reject transfer for non-matching room view model": assert => {
            const navigation = createNavigationForRoom(["a"], "a");
            const gridVM = new RoomGridViewModel({
                createRoomViewModelObservable: id => new RoomViewModelObservableMock(new RoomVMMock(id)),
                navigation,
                width: 3,
                height: 2,
            });
            const existingRoomVM = new RoomViewModelObservableMock(new RoomVMMock("f"));
            const transfered = gridVM.initializeRoomIdsAndTransferVM(navigation.path.get("rooms").value, existingRoomVM);
            assert.equal(transfered, false);
            assert.equal(gridVM.focusIndex, 0);
            assert.equal(gridVM.roomViewModelAt(0).id, "a");
        },
        "created & released room view model is not disposed": assert => {
            const navigation = createNavigationForRoom(["a"], "a");
            const gridVM = new RoomGridViewModel({
                createRoomViewModelObservable: id => new RoomViewModelObservableMock(new RoomVMMock(id)),
                navigation,
                width: 3,
                height: 2,
            });
            const transfered = gridVM.initializeRoomIdsAndTransferVM(navigation.path.get("rooms").value);
            assert.equal(transfered, false);
            const releasedVM = gridVM.releaseRoomViewModel("a");
            gridVM.dispose();
            assert.equal(releasedVM.get().disposed, false);
        },
        "transfered & released room view model is not disposed": assert => {
            const navigation = createNavigationForRoom([undefined, "a"], "a");
            const gridVM = new RoomGridViewModel({
                createRoomViewModelObservable: () => assert.fail("no vms should be created"),
                navigation,
                width: 3,
                height: 2,
            });
            const existingRoomVM = new RoomViewModelObservableMock(new RoomVMMock("a"));
            const transfered = gridVM.initializeRoomIdsAndTransferVM(navigation.path.get("rooms").value, existingRoomVM);
            assert.equal(transfered, true);
            const releasedVM = gridVM.releaseRoomViewModel("a");
            gridVM.dispose();
            assert.equal(releasedVM.get().disposed, false);
        },
        "try release non-existing room view model is": assert => {
            const navigation = createNavigationForEmptyTile([undefined, "b"], 3);
            const gridVM = new RoomGridViewModel({
                createRoomViewModelObservable: id => new RoomViewModelObservableMock(new RoomVMMock(id)),
                navigation,
                width: 3,
                height: 2,
            });
            gridVM.initializeRoomIdsAndTransferVM(navigation.path.get("rooms").value);
            const releasedVM = gridVM.releaseRoomViewModel("c");
            assert(!releasedVM);
        },
        "initial focus is set to empty tile": assert => {
            const navigation = createNavigationForEmptyTile(["a"], 1);
            const gridVM = new RoomGridViewModel({
                createRoomViewModelObservable: id => new RoomViewModelObservableMock(new RoomVMMock(id)),
                navigation,
                width: 3,
                height: 2,
            });
            gridVM.initializeRoomIdsAndTransferVM(navigation.path.get("rooms").value);
            assert.equal(gridVM.focusIndex, 1);
            assert.equal(gridVM.roomViewModelAt(0).id, "a");
        },
        "change room ids after creation": assert => {
            const navigation = createNavigationForRoom(["a", "b"], "a");
            const gridVM = new RoomGridViewModel({
                createRoomViewModelObservable: id => new RoomViewModelObservableMock(new RoomVMMock(id)),
                navigation,
                width: 3,
                height: 2,
            });
            navigation.observe("rooms").subscribe(roomIds => {
                gridVM.setRoomIds(roomIds);
            });
            gridVM.initializeRoomIdsAndTransferVM(navigation.path.get("rooms").value);
            const oldA = gridVM.roomViewModelAt(0);
            const oldB = gridVM.roomViewModelAt(1);
            assert.equal(oldA.id, "a");
            assert.equal(oldB.id, "b");
            navigation.applyPath(navigation.path
                .with(navigation.segment("rooms", ["b", "c", "b"]))
                .with(navigation.segment("room", "c"))
            );
            assert.equal(oldA.disposed, true);
            assert.equal(oldB.disposed, true);
            assert.equal(gridVM.focusIndex, 1);
            assert.equal(gridVM.roomViewModelAt(0).id, "b");
            assert.equal(gridVM.roomViewModelAt(0).disposed, false);
            assert.equal(gridVM.roomViewModelAt(1).id, "c");
            assert.equal(gridVM.roomViewModelAt(1).focused, true);
            assert.equal(gridVM.roomViewModelAt(2), undefined);
        }
    };
}
