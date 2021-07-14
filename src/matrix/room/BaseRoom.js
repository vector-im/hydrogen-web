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

import {EventEmitter} from "../../utils/EventEmitter.js";
import {RoomSummary} from "./RoomSummary.js";
import {GapWriter} from "./timeline/persistence/GapWriter.js";
import {RelationWriter} from "./timeline/persistence/RelationWriter.js";
import {Timeline} from "./timeline/Timeline.js";
import {FragmentIdComparer} from "./timeline/FragmentIdComparer.js";
import {WrappedError} from "../error.js"
import {fetchOrLoadMembers} from "./members/load.js";
import {MemberList} from "./members/MemberList.js";
import {Heroes} from "./members/Heroes.js";
import {EventEntry} from "./timeline/entries/EventEntry.js";
import {ObservedEventMap} from "./ObservedEventMap.js";
import {DecryptionSource} from "../e2ee/common.js";
import {ensureLogItem} from "../../logging/utils.js";
import {PowerLevels} from "./timeline/PowerLevels.js";
import {RetainedObservableValue} from "../../observable/ObservableValue.js";

const EVENT_ENCRYPTED_TYPE = "m.room.encrypted";

export class BaseRoom extends EventEmitter {
    constructor({roomId, storage, hsApi, mediaRepository, emitCollectionChange, user, createRoomEncryption, getSyncToken, platform}) {
        super();
        this._roomId = roomId;
        this._storage = storage;
        this._hsApi = hsApi;
        this._mediaRepository = mediaRepository;
        this._summary = new RoomSummary(roomId);
        this._fragmentIdComparer = new FragmentIdComparer([]);
        this._emitCollectionChange = emitCollectionChange;
        this._timeline = null;
        this._user = user;
        this._changedMembersDuringSync = null;
        this._memberList = null;
        this._createRoomEncryption = createRoomEncryption;
        this._roomEncryption = null;
        this._getSyncToken = getSyncToken;
        this._platform = platform;
        this._observedEvents = null;
    }

    async _eventIdsToEntries(eventIds, txn) {
        const retryEntries = [];
        await Promise.all(eventIds.map(async eventId => {
            const storageEntry = await txn.timelineEvents.getByEventId(this._roomId, eventId);
            if (storageEntry) {
                retryEntries.push(new EventEntry(storageEntry, this._fragmentIdComparer));
            }
        }));
        return retryEntries;
    }

    _getAdditionalTimelineRetryEntries(otherRetryEntries, roomKeys) {
        let retryTimelineEntries = this._roomEncryption.filterUndecryptedEventEntriesForKeys(this._timeline.remoteEntries, roomKeys);
        // filter out any entries already in retryEntries so we don't decrypt them twice
        const existingIds = otherRetryEntries.reduce((ids, e) => {ids.add(e.id); return ids;}, new Set());
        retryTimelineEntries = retryTimelineEntries.filter(e => !existingIds.has(e.id));
        return retryTimelineEntries;
    }

    /**
     * Used for retrying decryption from other sources than sync, like key backup.
     * @internal
     * @param  {RoomKey} roomKey
     * @param  {Array<string>} eventIds any event ids that should be retried. There might be more in the timeline though for this key.
     * @return {Promise}
     */
    async notifyRoomKey(roomKey, eventIds, log) {
        if (!this._roomEncryption) {
            return;
        }
        const txn = await this._storage.readTxn([
            this._storage.storeNames.timelineEvents,
            this._storage.storeNames.inboundGroupSessions,
        ]);
        let retryEntries = await this._eventIdsToEntries(eventIds, txn);
        if (this._timeline) {
            const retryTimelineEntries = this._getAdditionalTimelineRetryEntries(retryEntries, [roomKey]);
            retryEntries = retryEntries.concat(retryTimelineEntries);
        }
        if (retryEntries.length) {
            const decryptRequest = this._decryptEntries(DecryptionSource.Retry, retryEntries, txn, log);
            // this will close txn while awaiting decryption
            await decryptRequest.complete();

            this._timeline?.replaceEntries(retryEntries);
            // we would ideally write the room summary in the same txn as the groupSessionDecryptions in the
            // _decryptEntries entries and could even know which events have been decrypted for the first
            // time from DecryptionChanges.write and only pass those to the summary. As timeline changes
            // are not essential to the room summary, it's fine to write this in a separate txn for now.
            const changes = this._summary.data.applyTimelineEntries(retryEntries, false, false);
            if (await this._summary.writeAndApplyData(changes, this._storage)) {
                this._emitUpdate();
            }
        }
    }

    _setEncryption(roomEncryption) {
        if (roomEncryption && !this._roomEncryption) {
            this._roomEncryption = roomEncryption;
            if (this._timeline) {
                this._timeline.enableEncryption(this._decryptEntries.bind(this, DecryptionSource.Timeline));
            }
            return true;
        }
        return false;
    }

    /**
     * Used for decrypting when loading/filling the timeline, and retrying decryption,
     * not during sync, where it is split up during the multiple phases.
     */
    _decryptEntries(source, entries, inboundSessionTxn, log = null) {
        const request = new DecryptionRequest(async (r, log) => {
            if (!inboundSessionTxn) {
                inboundSessionTxn = await this._storage.readTxn([this._storage.storeNames.inboundGroupSessions]);
            }
            if (r.cancelled) return;
            const events = entries.filter(entry => {
                return entry.eventType === EVENT_ENCRYPTED_TYPE;
            }).map(entry => entry.event);
            r.preparation = await this._roomEncryption.prepareDecryptAll(events, null, source, inboundSessionTxn);
            if (r.cancelled) return;
            const changes = await r.preparation.decrypt();
            r.preparation = null;
            if (r.cancelled) return;
            const stores = [this._storage.storeNames.groupSessionDecryptions];
            const isTimelineOpen = this._isTimelineOpen;
            if (isTimelineOpen) {
                // read to fetch devices if timeline is open
                stores.push(this._storage.storeNames.deviceIdentities);
            }
            const writeTxn = await this._storage.readWriteTxn(stores);
            let decryption;
            try {
                decryption = await changes.write(writeTxn, log);
                if (isTimelineOpen) {
                    await decryption.verifySenders(writeTxn);
                }
            } catch (err) {
                writeTxn.abort();
                throw err;
            }
            await writeTxn.complete();
            // TODO: log decryption errors here
            decryption.applyToEntries(entries);
            if (this._observedEvents) {
                this._observedEvents.updateEvents(entries);
            }
        }, ensureLogItem(log));
        return request;
    }

    // TODO: move this to Room
    async _getSyncRetryDecryptEntries(newKeys, roomEncryption, txn) {
        const entriesPerKey = await Promise.all(newKeys.map(async key => {
            const retryEventIds = await roomEncryption.getEventIdsForMissingKey(key, txn);
            if (retryEventIds) {
                return this._eventIdsToEntries(retryEventIds, txn);
            }
        }));
        let retryEntries = entriesPerKey.reduce((allEntries, entries) => entries ? allEntries.concat(entries) : allEntries, []);
        // If we have the timeline open, see if there are more entries for the new keys
        // as we only store missing session information for synced events, not backfilled.
        // We want to decrypt all events we can though if the user is looking
        // at them when the timeline is open
        if (this._timeline) {
            const retryTimelineEntries = this._getAdditionalTimelineRetryEntries(retryEntries, newKeys);
            // make copies so we don't modify the original entry in writeSync, before the afterSync stage
            const retryTimelineEntriesCopies = retryTimelineEntries.map(e => e.clone());
            // add to other retry entries
            retryEntries = retryEntries.concat(retryTimelineEntriesCopies);
        }
        return retryEntries;
    }

    /** @package */
    async load(summary, txn, log) {
        log.set("id", this.id);
        try {
            // if called from sync, there is no summary yet
            if (summary) {
                this._summary.load(summary);
            }
            if (this._summary.data.encryption) {
                const roomEncryption = this._createRoomEncryption(this, this._summary.data.encryption);
                this._setEncryption(roomEncryption);
            }
            // need to load members for name?
            if (this._summary.data.needsHeroes) {
                this._heroes = new Heroes(this._roomId);
                const changes = await this._heroes.calculateChanges(this._summary.data.heroes, [], txn);
                this._heroes.applyChanges(changes, this._summary.data);
            }
        } catch (err) {
            throw new WrappedError(`Could not load room ${this._roomId}`, err);
        }
    }

    /** @public */
    async loadMemberList(log = null) {
        if (this._memberList) {
            // TODO: also await fetchOrLoadMembers promise here
            this._memberList.retain();
            return this._memberList;
        } else {
            const members = await fetchOrLoadMembers({
                summary: this._summary,
                roomId: this._roomId,
                hsApi: this._hsApi,
                storage: this._storage,
                syncToken: this._getSyncToken(),
                // to handle race between /members and /sync
                setChangedMembersMap: map => this._changedMembersDuringSync = map,
                log,
            }, this._platform.logger);
            this._memberList = new MemberList({
                members,
                closeCallback: () => { this._memberList = null; }
            });
            return this._memberList;
        }
    } 

    /** @public */
    fillGap(fragmentEntry, amount, log = null) {
        // TODO move some/all of this out of BaseRoom
        return this._platform.logger.wrapOrRun(log, "fillGap", async log => {
            log.set("id", this.id);
            log.set("fragment", fragmentEntry.fragmentId);
            log.set("dir", fragmentEntry.direction.asApiString());
            if (fragmentEntry.edgeReached) {
                log.set("edgeReached", true);
                return;
            }
            const response = await this._hsApi.messages(this._roomId, {
                from: fragmentEntry.token,
                dir: fragmentEntry.direction.asApiString(),
                limit: amount,
                filter: {
                    lazy_load_members: true,
                    include_redundant_members: true,
                }
            }, {log}).response();

            const txn = await this._storage.readWriteTxn([
                this._storage.storeNames.pendingEvents,
                this._storage.storeNames.timelineEvents,
                this._storage.storeNames.timelineRelations,
                this._storage.storeNames.timelineFragments,
            ]);
            let extraGapFillChanges;
            let gapResult;
            try {
                // detect remote echos of pending messages in the gap
                extraGapFillChanges = await this._writeGapFill(response.chunk, txn, log);
                // write new events into gap
                const relationWriter = new RelationWriter({
                    roomId: this._roomId,
                    fragmentIdComparer: this._fragmentIdComparer,
                    ownUserId: this._user.id,
                });
                const gapWriter = new GapWriter({
                    roomId: this._roomId,
                    storage: this._storage,
                    fragmentIdComparer: this._fragmentIdComparer,
                    relationWriter
                });
                gapResult = await gapWriter.writeFragmentFill(fragmentEntry, response, txn, log);
            } catch (err) {
                txn.abort();
                throw err;
            }
            await txn.complete();
            if (this._roomEncryption) {
                const decryptRequest = this._decryptEntries(DecryptionSource.Timeline, gapResult.entries, null, log);
                await decryptRequest.complete();
            }
            // once txn is committed, update in-memory state & emit events
            for (const fragment of gapResult.fragments) {
                this._fragmentIdComparer.add(fragment);
            }
            if (extraGapFillChanges) {
                this._applyGapFill(extraGapFillChanges);
            }
            if (this._timeline) {
                // these should not be added if not already there
                this._timeline.replaceEntries(gapResult.updatedEntries);
                this._timeline.addEntries(gapResult.entries);
            }
        });
    }

    /**
    allow sub classes to integrate in the gap fill lifecycle.
    JoinedRoom uses this update remote echos.
    */
    // eslint-disable-next-line no-unused-vars
    async _writeGapFill(chunk, txn, log) {}
    _applyGapFill() {}

    /** @public */
    get name() {
        if (this._heroes) {
            return this._heroes.roomName;
        }
        const summaryData = this._summary.data;
        if (summaryData.name) {
            return summaryData.name;
        }
        if (summaryData.canonicalAlias) {
            return summaryData.canonicalAlias;
        }
        return null;
    }

    /** @public */
    get id() {
        return this._roomId;
    }

    get avatarUrl() {
        if (this._summary.data.avatarUrl) {
            return this._summary.data.avatarUrl;
        } else if (this._heroes) {
            return this._heroes.roomAvatarUrl;
        }
        return null;
    }

    get lastMessageTimestamp() {
        return this._summary.data.lastMessageTimestamp;
    }

    get isLowPriority() {
        const tags = this._summary.data.tags;
        return !!(tags && tags['m.lowpriority']);
    }

    get isEncrypted() {
        return !!this._summary.data.encryption;
    }

    get isJoined() {
        return this.membership === "join";
    }

    get isLeft() {
        return this.membership === "leave";
    }

    get canonicalAlias() {
        return this._summary.data.canonicalAlias;
    }

    get joinedMemberCount() {
        return this._summary.data.joinCount;
    }

    get mediaRepository() {
        return this._mediaRepository;
    }

    get membership() {
        return this._summary.data.membership;
    }

    async loadPowerLevels() {
        const txn = await this._storage.readTxn([this._storage.storeNames.roomState]);
        const powerLevelsState = await txn.roomState.get(this._roomId, "m.room.power_levels", "");
        if (powerLevelsState) {
            return new PowerLevels({
                powerLevelEvent: powerLevelsState.event,
                ownUserId: this._user.id,
                membership: this.membership
            });
        }
        const createState = await txn.roomState.get(this._roomId, "m.room.create", "");
        if (createState) {
            return new PowerLevels({
                createEvent: createState.event,
                ownUserId: this._user.id,
                membership: this.membership
            });
        } else {
            const membership = this.membership;
            return new PowerLevels({ownUserId: this._user.id, membership});
        }
    }

    async observePowerLevels() {
        let observable = this._powerLevels;
        if (!observable) {
            const powerLevels = await this.loadPowerLevels();
            observable = new RetainedObservableValue(powerLevels, () => { this._powerLevels = null; });
            this._powerLevels = observable;
        }
        return observable;
    }

    enableSessionBackup(sessionBackup) {
        this._roomEncryption?.enableSessionBackup(sessionBackup);
        // TODO: do we really want to do this every time you open the app?
        if (this._timeline) {
            this._platform.logger.run("enableSessionBackup", log => {
                return this._roomEncryption.restoreMissingSessionsFromBackup(this._timeline.remoteEntries, log);
            });
        }
    }

    get _isTimelineOpen() {
        return !!this._timeline;
    }

    _emitUpdate() {
        // once for event emitter listeners
        this.emit("change");
        // and once for collection listeners
        this._emitCollectionChange(this);
    }

    /** @public */
    openTimeline(log = null) {
        return this._platform.logger.wrapOrRun(log, "open timeline", async log => {
            log.set("id", this.id);
            if (this._timeline) {
                throw new Error("not dealing with load race here for now");
            }
            this._timeline = new Timeline({
                roomId: this.id,
                storage: this._storage,
                fragmentIdComparer: this._fragmentIdComparer,
                pendingEvents: this._getPendingEvents(),
                closeCallback: () => {
                    this._timeline = null;
                    if (this._roomEncryption) {
                        this._roomEncryption.notifyTimelineClosed();
                    }
                },
                clock: this._platform.clock,
                logger: this._platform.logger,
                powerLevelsObservable: await this.observePowerLevels()
            });
            try {
                if (this._roomEncryption) {
                    this._timeline.enableEncryption(this._decryptEntries.bind(this, DecryptionSource.Timeline));
                }
                await this._timeline.load(this._user, this.membership, log);
            } catch (err) {
                // this also clears this._timeline in the closeCallback
                this._timeline.dispose();
                throw err;
            }
            return this._timeline;
        });
    }

    /* allow subclasses to provide an observable list with pending events when opening the timeline */
    _getPendingEvents() { return null; }

    observeEvent(eventId) {
        if (!this._observedEvents) {
            this._observedEvents = new ObservedEventMap(() => {
                this._observedEvents = null;
            });
        }
        let entry = null;
        if (this._timeline) {
            entry = this._timeline.getByEventId(eventId);
        }
        const observable = this._observedEvents.observe(eventId, entry);
        if (!entry) {
            // update in the background
            this._readEventById(eventId).then(entry => {
                observable.update(entry);
            }).catch(err => {
                console.warn(`could not load event ${eventId} from storage`, err);
            });
        }
        return observable;
    }

    async _readEventById(eventId) {
        let stores = [this._storage.storeNames.timelineEvents];
        if (this.isEncrypted) {
            stores.push(this._storage.storeNames.inboundGroupSessions);
        }
        const txn = await this._storage.readTxn(stores);
        const storageEntry = await txn.timelineEvents.getByEventId(this._roomId, eventId);
        if (storageEntry) {
            const entry = new EventEntry(storageEntry, this._fragmentIdComparer);
            if (entry.eventType === EVENT_ENCRYPTED_TYPE) {
                const request = this._decryptEntries(DecryptionSource.Timeline, [entry], txn);
                await request.complete();
            }
            return entry;
        }
    }


    dispose() {
        this._roomEncryption?.dispose();
        this._timeline?.dispose();
    }
}

class DecryptionRequest {
    constructor(decryptFn, log) {
        this._cancelled = false;
        this.preparation = null;
        this._promise = log.wrap("decryptEntries", log => decryptFn(this, log));
    }

    complete() {
        return this._promise;
    }

    get cancelled() {
        return this._cancelled;
    }

    dispose() {
        this._cancelled = true;
        if (this.preparation) {
            this.preparation.dispose();
        }
    }
}
