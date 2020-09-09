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

import {Room} from "./room/Room.js";
import { ObservableMap } from "../observable/index.js";
import { SendScheduler, RateLimitingBackoff } from "./SendScheduler.js";
import {User} from "./User.js";
import {DeviceMessageHandler} from "./DeviceMessageHandler.js";
import {Account as E2EEAccount} from "./e2ee/Account.js";
import {Decryption as OlmDecryption} from "./e2ee/olm/Decryption.js";
import {Encryption as OlmEncryption} from "./e2ee/olm/Encryption.js";
import {Decryption as MegOlmDecryption} from "./e2ee/megolm/Decryption.js";
import {Encryption as MegOlmEncryption} from "./e2ee/megolm/Encryption.js";
import {MEGOLM_ALGORITHM} from "./e2ee/common.js";
import {RoomEncryption} from "./e2ee/RoomEncryption.js";
import {DeviceTracker} from "./e2ee/DeviceTracker.js";
import {LockMap} from "../utils/LockMap.js";

const PICKLE_KEY = "DEFAULT_KEY";

export class Session {
    // sessionInfo contains deviceId, userId and homeServer
    constructor({clock, storage, hsApi, sessionInfo, olm}) {
        this._clock = clock;
        this._storage = storage;
        this._hsApi = hsApi;
        this._syncInfo = null;
        this._sessionInfo = sessionInfo;
        this._rooms = new ObservableMap();
        this._sendScheduler = new SendScheduler({hsApi, backoff: new RateLimitingBackoff()});
        this._roomUpdateCallback = (room, params) => this._rooms.update(room.id, params);
        this._user = new User(sessionInfo.userId);
        this._deviceMessageHandler = new DeviceMessageHandler({storage});
        this._olm = olm;
        this._olmUtil = null;
        this._e2eeAccount = null;
        this._deviceTracker = null;
        this._olmEncryption = null;
        this._megolmEncryption = null;
        this._megolmDecryption = null;
        this._getSyncToken = () => this.syncToken;

        if (olm) {
            this._olmUtil = new olm.Utility();
            this._deviceTracker = new DeviceTracker({
                storage,
                getSyncToken: this._getSyncToken,
                olmUtil: this._olmUtil,
                ownUserId: sessionInfo.userId,
                ownDeviceId: sessionInfo.deviceId,
            });
        }
        this._createRoomEncryption = this._createRoomEncryption.bind(this);
    }

    // called once this._e2eeAccount is assigned
    _setupEncryption() {
        console.log("loaded e2ee account with keys", this._e2eeAccount.identityKeys);
        const senderKeyLock = new LockMap();
        const olmDecryption = new OlmDecryption({
            account: this._e2eeAccount,
            pickleKey: PICKLE_KEY,
            olm: this._olm,
            storage: this._storage,
            now: this._clock.now,
            ownUserId: this._user.id,
            senderKeyLock
        });
        this._olmEncryption = new OlmEncryption({
            account: this._e2eeAccount,
            pickleKey: PICKLE_KEY,
            olm: this._olm,
            storage: this._storage,
            now: this._clock.now,
            ownUserId: this._user.id,
            olmUtil: this._olmUtil,
            senderKeyLock
        });
        this._megolmEncryption = new MegOlmEncryption({
            account: this._e2eeAccount,
            pickleKey: PICKLE_KEY,
            olm: this._olm,
            storage: this._storage,
            now: this._clock.now,
            ownDeviceId: this._sessionInfo.deviceId,
        });
        this._megolmDecryption = new MegOlmDecryption({
            pickleKey: PICKLE_KEY,
            olm: this._olm,
        });
        this._deviceMessageHandler.enableEncryption({olmDecryption, megolmDecryption: this._megolmDecryption});
    }

    _createRoomEncryption(room, encryptionParams) {
        // TODO: this will actually happen when users start using the e2ee version for the first time

        // this should never happen because either a session was already synced once
        // and thus an e2ee account was created as well and _setupEncryption is called from load
        // OR
        // this is a new session and loading it will load zero rooms, thus not calling this method.
        // in this case _setupEncryption is called from beforeFirstSync, right after load,
        // so any incoming synced rooms won't be there yet
        if (!this._olmEncryption) {
            throw new Error("creating room encryption before encryption got globally enabled");
        }
        // only support megolm
        if (encryptionParams.algorithm !== MEGOLM_ALGORITHM) {
            return null;
        }
        return new RoomEncryption({
            room,
            deviceTracker: this._deviceTracker,
            olmEncryption: this._olmEncryption,
            megolmEncryption: this._megolmEncryption,
            megolmDecryption: this._megolmDecryption,
            storage: this._storage,
            encryptionParams
        });
    }

    // called after load
    async beforeFirstSync(isNewLogin) {
        if (this._olm) {
            if (isNewLogin && this._e2eeAccount) {
                throw new Error("there should not be an e2ee account already on a fresh login");
            }
            if (!this._e2eeAccount) {
                const txn = await this._storage.readWriteTxn([
                    this._storage.storeNames.session
                ]);
                try {
                    this._e2eeAccount = await E2EEAccount.create({
                        hsApi: this._hsApi,
                        olm: this._olm,
                        pickleKey: PICKLE_KEY,
                        userId: this._sessionInfo.userId,
                        deviceId: this._sessionInfo.deviceId,
                        txn
                    });
                } catch (err) {
                    txn.abort();
                    throw err;
                }
                await txn.complete();
                this._setupEncryption();
            }
            await this._e2eeAccount.generateOTKsIfNeeded(this._storage);
            await this._e2eeAccount.uploadKeys(this._storage);
            await this._deviceMessageHandler.decryptPending(this.rooms);
        }
    }

    async load() {
        const txn = await this._storage.readTxn([
            this._storage.storeNames.session,
            this._storage.storeNames.roomSummary,
            this._storage.storeNames.roomMembers,
            this._storage.storeNames.timelineEvents,
            this._storage.storeNames.timelineFragments,
            this._storage.storeNames.pendingEvents,
        ]);
        // restore session object
        this._syncInfo = await txn.session.get("sync");
        // restore e2ee account, if any
        if (this._olm) {
            this._e2eeAccount = await E2EEAccount.load({
                hsApi: this._hsApi,
                olm: this._olm,
                pickleKey: PICKLE_KEY,
                userId: this._sessionInfo.userId,
                deviceId: this._sessionInfo.deviceId,
                txn
            });
            if (this._e2eeAccount) {
                this._setupEncryption();
            }
        }
        const pendingEventsByRoomId = await this._getPendingEventsByRoom(txn);
        // load rooms
        const rooms = await txn.roomSummary.getAll();
        await Promise.all(rooms.map(summary => {
            const room = this.createRoom(summary.roomId, pendingEventsByRoomId.get(summary.roomId));
            return room.load(summary, txn);
        }));
    }

    get isStarted() {
        return this._sendScheduler.isStarted;
    }

    stop() {
        this._sendScheduler.stop();
    }

    async start(lastVersionResponse) {
        if (lastVersionResponse) {
            // store /versions response
            const txn = await this._storage.readWriteTxn([
                this._storage.storeNames.session
            ]);
            txn.session.set("serverVersions", lastVersionResponse);
            // TODO: what can we do if this throws?
            await txn.complete();
        }

        this._sendScheduler.start();
        for (const [, room] of this._rooms) {
            room.start();
        }
    }

    async _getPendingEventsByRoom(txn) {
        const pendingEvents = await txn.pendingEvents.getAll();
        return pendingEvents.reduce((groups, pe) => {
            const group = groups.get(pe.roomId);
            if (group) {
                group.push(pe);
            } else {
                groups.set(pe.roomId, [pe]);
            }
            return groups;
        }, new Map());
    }

    get rooms() {
        return this._rooms;
    }

    createRoom(roomId, pendingEvents) {
        const room = new Room({
            roomId,
            getSyncToken: this._getSyncToken,
            storage: this._storage,
            emitCollectionChange: this._roomUpdateCallback,
            hsApi: this._hsApi,
            sendScheduler: this._sendScheduler,
            pendingEvents,
            user: this._user,
            createRoomEncryption: this._createRoomEncryption
        });
        this._rooms.add(roomId, room);
        return room;
    }

    async writeSync(syncResponse, syncFilterId, roomChanges, txn) {
        const changes = {};
        const syncToken = syncResponse.next_batch;
        const deviceOneTimeKeysCount = syncResponse.device_one_time_keys_count;

        if (this._e2eeAccount && deviceOneTimeKeysCount) {
            changes.e2eeAccountChanges = this._e2eeAccount.writeSync(deviceOneTimeKeysCount, txn);
        }
        if (syncToken !== this.syncToken) {
            const syncInfo = {token: syncToken, filterId: syncFilterId};
            // don't modify `this` because transaction might still fail
            txn.session.set("sync", syncInfo);
            changes.syncInfo = syncInfo;
        }
        if (this._deviceTracker) {
            const deviceLists = syncResponse.device_lists;
            if (deviceLists) {
                await this._deviceTracker.writeDeviceChanges(deviceLists, txn);
            }
        }

        const toDeviceEvents = syncResponse.to_device?.events;
        if (Array.isArray(toDeviceEvents)) {
            this._deviceMessageHandler.writeSync(toDeviceEvents, txn);
        }
        return changes;
    }

    afterSync({syncInfo, e2eeAccountChanges}) {
        if (syncInfo) {
            // sync transaction succeeded, modify object state now
            this._syncInfo = syncInfo;
        }
        if (this._e2eeAccount && e2eeAccountChanges) {
            this._e2eeAccount.afterSync(e2eeAccountChanges);
        }
    }

    async afterSyncCompleted() {
        const needsToUploadOTKs = await this._e2eeAccount.generateOTKsIfNeeded(this._storage);
        const promises = [this._deviceMessageHandler.decryptPending(this.rooms)];
        if (needsToUploadOTKs) {
            // TODO: we could do this in parallel with sync if it proves to be too slow
            // but I'm not sure how to not swallow errors in that case
            promises.push(this._e2eeAccount.uploadKeys(this._storage));
        }
        // run key upload and decryption in parallel
        await Promise.all(promises);
    }

    get syncToken() {
        return this._syncInfo?.token;
    }

    get syncFilterId() {
        return this._syncInfo?.filterId;
    }

    get user() {
        return this._user;
    }
}

export function tests() {
    function createStorageMock(session, pendingEvents = []) {
        return {
            readTxn() {
                return Promise.resolve({
                    session: {
                        get(key) {
                            return Promise.resolve(session[key]);
                        }
                    },
                    pendingEvents: {
                        getAll() {
                            return Promise.resolve(pendingEvents);
                        }
                    },
                    roomSummary: {
                        getAll() {
                            return Promise.resolve([]);
                        }
                    }
                });
            },
            storeNames: {}
        };
    }

    return {
        "session data is not modified until after sync": async (assert) => {
            const session = new Session({storage: createStorageMock({
                sync: {token: "a", filterId: 5}
            }), sessionInfo: {userId: ""}});
            await session.load();
            let syncSet = false;
            const syncTxn = {
                session: {
                    set(key, value) {
                        if (key === "sync") {
                            assert.equal(value.token, "b");
                            assert.equal(value.filterId, 6);
                            syncSet = true;
                        }
                    }
                }
            };
            const newSessionData = await session.writeSync({next_batch: "b"}, 6, {}, syncTxn);
            assert(syncSet);
            assert.equal(session.syncToken, "a");
            assert.equal(session.syncFilterId, 5);
            session.afterSync(newSessionData);
            assert.equal(session.syncToken, "b");
            assert.equal(session.syncFilterId, 6);
        }
    }
}
