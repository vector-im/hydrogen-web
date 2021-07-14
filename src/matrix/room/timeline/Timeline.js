/*
Copyright 2020 Bruno Windels <bruno@windels.cloud>
Copyright 2021 The Matrix.org Foundation C.I.C.

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

import {SortedArray, AsyncMappedList, ConcatList, ObservableArray} from "../../../observable/index.js";
import {Disposables} from "../../../utils/Disposables.js";
import {Direction} from "./Direction.js";
import {TimelineReader} from "./persistence/TimelineReader.js";
import {PendingEventEntry} from "./entries/PendingEventEntry.js";
import {RoomMember} from "../members/RoomMember.js";
import {getRelation, ANNOTATION_RELATION_TYPE} from "./relations.js";
import {REDACTION_TYPE} from "../common.js";

export class Timeline {
    constructor({roomId, storage, closeCallback, fragmentIdComparer, pendingEvents, clock, powerLevelsObservable}) {
        this._roomId = roomId;
        this._storage = storage;
        this._closeCallback = closeCallback;
        this._fragmentIdComparer = fragmentIdComparer;
        this._disposables = new Disposables();
        this._pendingEvents = pendingEvents;
        this._clock = clock;
        // constructing this early avoid some problem while sync and openTimeline race
        this._remoteEntries = new SortedArray((a, b) => a.compare(b));
        this._ownMember = null;
        this._timelineReader = new TimelineReader({
            roomId: this._roomId,
            storage: this._storage,
            fragmentIdComparer: this._fragmentIdComparer
        });
        this._readerRequest = null;
        this._allEntries = null;
        this._powerLevels = powerLevelsObservable.get();
        this._disposables.track(powerLevelsObservable.subscribe(powerLevels => this._powerLevels = powerLevels));
    }

    /** @package */
    async load(user, membership, log) {
        const txn = await this._storage.readTxn(this._timelineReader.readTxnStores.concat(
            this._storage.storeNames.roomMembers,
            this._storage.storeNames.roomState
        ));
        const memberData = await txn.roomMembers.get(this._roomId, user.id);
        if (memberData) {
            this._ownMember = new RoomMember(memberData);
        } else {
            // this should never happen, as our own join into the room would have
            // made us receive our own member event, but just to be on the safe side and not crash,
            // fall back to bare user id
            this._ownMember = RoomMember.fromUserId(this._roomId, user.id, membership);
        }
        // it should be fine to not update the local entries,
        // as they should only populate once the view subscribes to it
        // if they are populated already, the sender profile would be empty

        // 30 seems to be a good amount to fill the entire screen
        const readerRequest = this._disposables.track(this._timelineReader.readFromEnd(30, txn, log));
        try {
            const entries = await readerRequest.complete();
            this._setupEntries(entries);
        } finally {
            this._disposables.disposeTracked(readerRequest);
        }
        // txn should be assumed to have finished here, as decryption will close it.
    }

    _setupEntries(timelineEntries) {
        this._remoteEntries.setManySorted(timelineEntries);
        if (this._pendingEvents) {
            this._localEntries = new AsyncMappedList(this._pendingEvents,
                pe => this._mapPendingEventToEntry(pe),
                (pee, params) => {
                    // is sending but redacted, who do we detect that here to remove the relation?
                    pee.notifyUpdate(params);
                },
                pee => this._applyAndEmitLocalRelationChange(pee, target => target.removeLocalRelation(pee))
            );
        } else {
            this._localEntries = new ObservableArray();
        }
        this._allEntries = new ConcatList(this._remoteEntries, this._localEntries);
    }

    async _mapPendingEventToEntry(pe) {
        // we load the redaction target for pending events,
        // so if we are redacting a relation, we can pass the redaction
        // to the relation target and the removal of the relation can
        // be taken into account for local echo.
        let redactingEntry;
        if (pe.eventType === REDACTION_TYPE) {
            redactingEntry = await this._getOrLoadEntry(pe.relatedTxnId, pe.relatedEventId);
        }
        const pee = new PendingEventEntry({
            pendingEvent: pe, member: this._ownMember,
            clock: this._clock, redactingEntry
        });
        this._applyAndEmitLocalRelationChange(pee, target => target.addLocalRelation(pee));
        return pee;
    }

    _applyAndEmitLocalRelationChange(pee, updater) {
        // this is the contract of findAndUpdate, used in _findAndUpdateRelatedEntry
        const updateOrFalse = e => {
            const params = updater(e);
            return params ? params : false;
        };
        this._findAndUpdateRelatedEntry(pee.pendingEvent.relatedTxnId, pee.relatedEventId, updateOrFalse);
        // also look for a relation target to update with this redaction
        if (pee.redactingEntry) {
            // redactingEntry might be a PendingEventEntry or an EventEntry, so don't assume pendingEvent
            const relatedTxnId = pee.redactingEntry.pendingEvent?.relatedTxnId;
            this._findAndUpdateRelatedEntry(relatedTxnId, pee.redactingEntry.relatedEventId, updateOrFalse);
        }
    }

    _findAndUpdateRelatedEntry(relatedTxnId, relatedEventId, updateOrFalse) {
        let found = false;
        // first, look in local entries based on txn id
        if (relatedTxnId) {
            found = this._localEntries.findAndUpdate(
                e => e.id === relatedTxnId,
                updateOrFalse,
            );
        }
        // if not found here, look in remote entries based on event id
        if (!found && relatedEventId) {
            this._remoteEntries.findAndUpdate(
                e => e.id === relatedEventId,
                updateOrFalse
            );
        }
    }

    async getOwnAnnotationEntry(targetId, key) {
        const txn = await this._storage.readWriteTxn([
            this._storage.storeNames.timelineEvents,
            this._storage.storeNames.timelineRelations,
        ]);
        const relations = await txn.timelineRelations.getForTargetAndType(this._roomId, targetId, ANNOTATION_RELATION_TYPE);
        for (const relation of relations) {
            const annotation = await txn.timelineEvents.getByEventId(this._roomId, relation.sourceEventId);
            if (annotation && annotation.event.sender === this._ownMember.userId && getRelation(annotation.event).key === key) {
                const eventEntry = new EventEntry(annotation, this._fragmentIdComparer);
                this._addLocalRelationsToNewRemoteEntries([eventEntry]);
                return eventEntry;
            }
        }
        return null;
    }

    /** @package */
    updateOwnMember(member) {
        this._ownMember = member;
    }

    _addLocalRelationsToNewRemoteEntries(entries) {
        // because it is not safe to iterate a derived observable collection
        // before it has any subscriptions, we bail out if this isn't
        // the case yet. This can happen when sync adds or replaces entries
        // before load has finished and the view has subscribed to the timeline.
        // 
        // Once the subscription is setup, MappedList will set up the local
        // relations as needed with _applyAndEmitLocalRelationChange,
        // so we're not missing anything by bailing out.
        //
        // _localEntries can also not yet exist
        if (!this._localEntries?.hasSubscriptions) {
            return;
        }
        // find any local relations to this new remote event
        for (const pee of this._localEntries) {
            // this will work because we set relatedEventId when removing remote echos
            if (pee.relatedEventId) {
                const relationTarget = entries.find(e => e.id === pee.relatedEventId);
                // no need to emit here as this entry is about to be added
                relationTarget?.addLocalRelation(pee);
            }
            if (pee.redactingEntry) {
                const eventId = pee.redactingEntry.relatedEventId;
                const relationTarget = entries.find(e => e.id === eventId);
                relationTarget?.addLocalRelation(pee);
            }
        }
    }

    // used in replaceEntries
    static _entryUpdater(existingEntry, entry) {
        entry.updateFrom(existingEntry);
        return entry;
    }

    /** @package */
    replaceEntries(entries) {
        this._addLocalRelationsToNewRemoteEntries(entries);
        for (const entry of entries) {
            this._remoteEntries.getAndUpdate(entry, Timeline._entryUpdater);
        }
    }

    /** @package */
    addEntries(newEntries) {
        this._addLocalRelationsToNewRemoteEntries(newEntries);
        this._remoteEntries.setManySorted(newEntries);
    }
    
    // tries to prepend `amount` entries to the `entries` list.
    /**
     * [loadAtTop description]
     * @param  {[type]} amount [description]
     * @return {boolean} true if the top of the timeline has been reached
     * 
     */
    async loadAtTop(amount) {
        if (this._disposables.isDisposed) {
            return true;
        }
        const firstEventEntry = this._remoteEntries.array.find(e => !!e.eventType);
        if (!firstEventEntry) {
            return true;
        }
        const readerRequest = this._disposables.track(this._timelineReader.readFrom(
            firstEventEntry.asEventKey(),
            Direction.Backward,
            amount
        ));
        try {
            const entries = await readerRequest.complete();
            this.addEntries(entries);
            return entries.length < amount;
        } finally {
            this._disposables.disposeTracked(readerRequest);
        }
    }

    async _getOrLoadEntry(txnId, eventId) {
        if (txnId) {
            // also look for redacting relation in pending events, in case the target is already being sent
            for (const p of this._localEntries) {
                if (p.id === txnId) {
                    return p;
                }
            }
        }
        if (eventId) {
            const loadedEntry = this.getByEventId(eventId);
            if (loadedEntry) {
                return loadedEntry;
            } else {
                const txn = await this._storage.readWriteTxn([
                    this._storage.storeNames.timelineEvents,
                ]);
                const redactionTargetEntry = await txn.timelineEvents.getByEventId(this._roomId, eventId);
                if (redactionTargetEntry) {
                    return new EventEntry(redactionTargetEntry, this._fragmentIdComparer);
                }
            }
        }
        return null;
    }

    getByEventId(eventId) {
        for (let i = 0; i < this._remoteEntries.length; i += 1) {
            const entry = this._remoteEntries.get(i);
            if (entry.id === eventId) {
                return entry;
            }
        }
        return null;
    }

    /** @public */
    get entries() {
        return this._allEntries;
    }

    /**
     * @internal
     * @return {Array<EventEntry>} remote event entries, should not be modified
     */
    get remoteEntries() {
        return this._remoteEntries.array;
    }

    /** @public */
    dispose() {
        if (this._closeCallback) {
            this._disposables.dispose();
            this._closeCallback();
            this._closeCallback = null;
        }
    }

    /** @internal */
    enableEncryption(decryptEntries) {
        this._timelineReader.enableEncryption(decryptEntries);
    }

    get powerLevels() {
        return this._powerLevels;
    }

    get me() {
        return this._ownMember;
    }
}

import {FragmentIdComparer} from "./FragmentIdComparer.js";
import {poll} from "../../../mocks/poll.js";
import {Clock as MockClock} from "../../../mocks/Clock.js";
import {createMockStorage} from "../../../mocks/Storage.js";
import {ListObserver} from "../../../mocks/ListObserver.js";
import {createEvent, withTextBody, withContent, withSender} from "../../../mocks/event.js";
import {NullLogItem} from "../../../logging/NullLogger.js";
import {EventEntry} from "./entries/EventEntry.js";
import {User} from "../../User.js";
import {PendingEvent} from "../sending/PendingEvent.js";
import {createAnnotation} from "./relations.js";

export function tests() {
    const fragmentIdComparer = new FragmentIdComparer([]);
    const roomId = "$abc";
    const alice = "@alice:hs.tld";
    const bob = "@bob:hs.tld";

    function getIndexFromIterable(it, n) {
        let i = 0;
        for (const item of it) {
            if (i === n) {
                return item;
            }
            i += 1;
        }
        throw new Error("not enough items in iterable");
    }

    return {
        "adding or replacing entries before subscribing to entries does not lose local relations": async assert => {
            const pendingEvents = new ObservableArray();
            const timeline = new Timeline({roomId, storage: await createMockStorage(),
                closeCallback: () => {}, fragmentIdComparer, pendingEvents, clock: new MockClock()});
            // 1. load timeline
            await timeline.load(new User(alice), "join", new NullLogItem());
            // 2. test replaceEntries and addEntries don't fail
            const event1 = withTextBody("hi!", withSender(bob, createEvent("m.room.message", "!abc")));
            const entry1 = new EventEntry({event: event1, fragmentId: 1, eventIndex: 1}, fragmentIdComparer);
            timeline.replaceEntries([entry1]);
            const event2 = withTextBody("hi bob!", withSender(alice, createEvent("m.room.message", "!def")));
            const entry2 = new EventEntry({event: event2, fragmentId: 1, eventIndex: 2}, fragmentIdComparer);
            timeline.addEntries([entry2]);
            // 3. add local relation (redaction)
            pendingEvents.append(new PendingEvent({data: {
                roomId,
                queueIndex: 1,
                eventType: "m.room.redaction",
                txnId: "t123",
                content: {},
                relatedEventId: event2.event_id
            }}));
            // 4. subscribe (it's now safe to iterate timeline.entries) 
            timeline.entries.subscribe(new ListObserver());
            // 5. check the local relation got correctly aggregated
            const locallyRedacted = await poll(() => Array.from(timeline.entries)[0].isRedacting);
            assert.equal(locallyRedacted, true);
        },
        "add and remove local reaction, and cancel again": async assert => {
            // 1. setup timeline with message
            const pendingEvents = new ObservableArray();
            const timeline = new Timeline({roomId, storage: await createMockStorage(),
                closeCallback: () => {}, fragmentIdComparer, pendingEvents, clock: new MockClock()});
            await timeline.load(new User(bob), "join", new NullLogItem());
            timeline.entries.subscribe(new ListObserver());
            const event = withTextBody("hi bob!", withSender(alice, createEvent("m.room.message", "!abc")));
            timeline.addEntries([new EventEntry({event, fragmentId: 1, eventIndex: 2}, fragmentIdComparer)]);
            let entry = getIndexFromIterable(timeline.entries, 0);
            // 2. add local reaction
            pendingEvents.append(new PendingEvent({data: {
                roomId,
                queueIndex: 1,
                eventType: "m.reaction",
                txnId: "t123",
                content: entry.annotate("👋"),
                relatedEventId: entry.id
            }}));
            await poll(() => timeline.entries.length === 2);
            assert.equal(entry.pendingAnnotations.get("👋").count, 1);
            const reactionEntry = getIndexFromIterable(timeline.entries, 1);
            // 3. add redaction to timeline
            pendingEvents.append(new PendingEvent({data: {
                roomId,
                queueIndex: 2,
                eventType: "m.room.redaction",
                txnId: "t456",
                content: {},
                relatedTxnId: reactionEntry.id
            }}));
            // TODO: await nextUpdate here with ListObserver, to ensure entry emits an update when pendingAnnotations changes
            await poll(() => timeline.entries.length === 3);
            assert.equal(entry.pendingAnnotations.get("👋").count, 0);
            // 4. cancel redaction
            pendingEvents.remove(1);
            await poll(() => timeline.entries.length === 2);
            assert.equal(entry.pendingAnnotations.get("👋").count, 1);
            // 5. cancel reaction
            pendingEvents.remove(0);
            await poll(() => timeline.entries.length === 1);
            assert(!entry.pendingAnnotations);
        },
        "getOwnAnnotationEntry": async assert => {
            const messageId = "!abc";
            const reactionId = "!def";
            // 1. put event and reaction into storage
            const storage = await createMockStorage();
            const txn = await storage.readWriteTxn([storage.storeNames.timelineEvents, storage.storeNames.timelineRelations]);
            txn.timelineEvents.insert({
                event: withContent(createAnnotation(messageId, "👋"), createEvent("m.reaction", reactionId, bob)),
                fragmentId: 1, eventIndex: 1, roomId
            });
            txn.timelineRelations.add(roomId, messageId, ANNOTATION_RELATION_TYPE, reactionId);
            await txn.complete();
            // 2. setup the timeline
            const timeline = new Timeline({roomId, storage, closeCallback: () => {},
                fragmentIdComparer, pendingEvents: new ObservableArray(), clock: new MockClock()});
            await timeline.load(new User(bob), "join", new NullLogItem());
            // 3. get the own annotation out
            const reactionEntry = await timeline.getOwnAnnotationEntry(messageId, "👋");
            assert.equal(reactionEntry.id, reactionId);
            assert.equal(reactionEntry.relation.key, "👋");
        },
        "remote reaction": async assert => {
            const messageEntry = new EventEntry({
                event: withTextBody("hi bob!", createEvent("m.room.message", "!abc", alice)),
                fragmentId: 1, eventIndex: 2, roomId,
                annotations: { // aggregated like RelationWriter would
                    "👋": {count: 1, me: true, firstTimestamp: 0}
                },
            }, fragmentIdComparer);
            // 2. setup timeline
            const pendingEvents = new ObservableArray();
            const timeline = new Timeline({roomId, storage: await createMockStorage(),
                closeCallback: () => {}, fragmentIdComparer, pendingEvents, clock: new MockClock()});
            await timeline.load(new User(bob), "join", new NullLogItem());
            timeline.entries.subscribe(new ListObserver());
            // 3. add message to timeline
            timeline.addEntries([messageEntry]);
            const entry = getIndexFromIterable(timeline.entries, 0);
            assert.equal(entry, messageEntry);
            assert.equal(entry.annotations["👋"].count, 1);
        },
        "remove remote reaction": async assert => {
            // 1. setup timeline
            const pendingEvents = new ObservableArray();
            const timeline = new Timeline({roomId, storage: await createMockStorage(),
                closeCallback: () => {}, fragmentIdComparer, pendingEvents, clock: new MockClock()});
            await timeline.load(new User(bob), "join", new NullLogItem());
            timeline.entries.subscribe(new ListObserver());
            // 2. add message and reaction to timeline
            const messageEntry = new EventEntry({
                event: withTextBody("hi bob!", createEvent("m.room.message", "!abc", alice)),
                fragmentId: 1, eventIndex: 2, roomId,
            }, fragmentIdComparer);
            const reactionEntry = new EventEntry({
                event: withContent(createAnnotation(messageEntry.id, "👋"), createEvent("m.reaction", "!def", bob)),
                fragmentId: 1, eventIndex: 3, roomId
            }, fragmentIdComparer);
            timeline.addEntries([messageEntry, reactionEntry]);
            // 3. redact reaction
            pendingEvents.append(new PendingEvent({data: {
                roomId,
                queueIndex: 1,
                eventType: "m.room.redaction",
                txnId: "t123",
                content: {},
                relatedEventId: reactionEntry.id
            }}));
            await poll(() => timeline.entries.length >= 3);
            assert.equal(messageEntry.pendingAnnotations.get("👋").count, -1);
        },
        "local reaction gets applied after remote echo is added to timeline": async assert => {
            const messageEntry = new EventEntry({event: withTextBody("hi bob!", withSender(alice, createEvent("m.room.message", "!abc"))),
                fragmentId: 1, eventIndex: 2}, fragmentIdComparer);
            // 1. setup timeline
            const pendingEvents = new ObservableArray();
            const timeline = new Timeline({roomId, storage: await createMockStorage(),
                closeCallback: () => {}, fragmentIdComparer, pendingEvents, clock: new MockClock()});
            await timeline.load(new User(bob), "join", new NullLogItem());
            timeline.entries.subscribe(new ListObserver());
            // 2. add local reaction
            pendingEvents.append(new PendingEvent({data: {
                roomId,
                queueIndex: 1,
                eventType: "m.reaction",
                txnId: "t123",
                content: messageEntry.annotate("👋"),
                relatedEventId: messageEntry.id
            }}));
            await poll(() => timeline.entries.length === 1);
            // 3. add remote reaction target
            timeline.addEntries([messageEntry]);
            await poll(() => timeline.entries.length === 2);
            const entry = getIndexFromIterable(timeline.entries, 0);
            assert.equal(entry, messageEntry);
            assert.equal(entry.pendingAnnotations.get("👋").count, 1);
        },
        "local reaction removal gets applied after remote echo is added to timeline with reaction not loaded": async assert => {
            const messageId = "!abc";
            const reactionId = "!def";
            // 1. put reaction in storage
            const storage = await createMockStorage();
            const txn = await storage.readWriteTxn([storage.storeNames.timelineEvents, storage.storeNames.timelineRelations]);
            txn.timelineEvents.insert({
                event: withContent(createAnnotation(messageId, "👋"), createEvent("m.reaction", reactionId, bob)),
                fragmentId: 1, eventIndex: 3, roomId
            });
            await txn.complete();
            // 2. setup timeline
            const pendingEvents = new ObservableArray();
            const timeline = new Timeline({roomId, storage, closeCallback: () => {},
                fragmentIdComparer, pendingEvents, clock: new MockClock()});
            await timeline.load(new User(bob), "join", new NullLogItem());
            timeline.entries.subscribe(new ListObserver());
            // 3. add local redaction for reaction
            pendingEvents.append(new PendingEvent({data: {
                roomId,
                queueIndex: 1,
                eventType: "m.room.redaction",
                txnId: "t123",
                content: {},
                relatedEventId: reactionId
            }}));
            await poll(() => timeline.entries.length === 1);
            // 4. add reaction target
            timeline.addEntries([new EventEntry({
                event: withTextBody("hi bob!", createEvent("m.room.message", messageId, alice)),
                fragmentId: 1, eventIndex: 2}, fragmentIdComparer)
            ]);
            await poll(() => timeline.entries.length === 2);
            // 5. check that redaction was linked to reaction target
            const entry = getIndexFromIterable(timeline.entries, 0);
            assert.equal(entry.pendingAnnotations.get("👋").count, -1);
        },
        "decrypted entry preserves content when receiving other update without decryption": async assert => {
            // 1. create encrypted and decrypted entry
            const encryptedEntry = new EventEntry({
                event: withContent({ciphertext: "abc"}, createEvent("m.room.encrypted", "!abc", alice)),
                    fragmentId: 1, eventIndex: 1, roomId
            }, fragmentIdComparer);
            const decryptedEntry = encryptedEntry.clone();
            decryptedEntry.setDecryptionResult({
                event: withTextBody("hi bob!", createEvent("m.room.message", encryptedEntry.id, encryptedEntry.sender))
            });
            // 2. setup the timeline
            const timeline = new Timeline({roomId, storage: await createMockStorage(), closeCallback: () => {},
                fragmentIdComparer, pendingEvents: new ObservableArray(), clock: new MockClock()});
            await timeline.load(new User(alice), "join", new NullLogItem());
            timeline.addEntries([decryptedEntry]);
            const observer = new ListObserver();
            timeline.entries.subscribe(observer);
            // 3. replace the entry with one that is not decrypted
            //    (as would happen when receiving a reaction,
            //    as it does not rerun the decryption)
            //    and check that the decrypted content is preserved
            timeline.replaceEntries([encryptedEntry]);
            const {value, type} = await observer.next();
            assert.equal(type, "update");
            assert.equal(value.eventType, "m.room.message");
            assert.equal(value.content.body, "hi bob!");
        }
    };
}
