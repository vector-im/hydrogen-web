/*
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
import {ObservableMap} from "../../../../observable/map/ObservableMap.js";

export class ReactionsViewModel {
    constructor(parentTile) {
        this._parentTile = parentTile;
        this._map = new ObservableMap();
        this._reactions = this._map.sortValues((a, b) => a._compare(b));
    }

    /** @package */
    update(annotations, pendingAnnotations) {
        if (annotations) {
            for (const key in annotations) {
                if (annotations.hasOwnProperty(key)) {
                    const annotation = annotations[key];
                    const reaction = this._map.get(key);
                    if (reaction) {
                        if (reaction._tryUpdate(annotation)) {
                            this._map.update(key);
                        }
                    } else {
                        this._map.add(key, new ReactionViewModel(key, annotation, null, this._parentTile));
                    }
                }
            }
        }
        if (pendingAnnotations) {
            for (const [key, annotation] of pendingAnnotations.entries()) {
                const reaction = this._map.get(key);
                if (reaction) {
                    reaction._tryUpdatePending(annotation);
                    this._map.update(key);
                } else {
                    this._map.add(key, new ReactionViewModel(key, null, annotation, this._parentTile));
                }
            }
        }
        for (const existingKey of this._map.keys()) {
            const hasPending = pendingAnnotations?.has(existingKey);
            const hasRemote = annotations?.hasOwnProperty(existingKey);
            if (!hasRemote && !hasPending) {
                this._map.remove(existingKey);
            } else if (!hasRemote) {
                if (this._map.get(existingKey)._tryUpdate(null)) {
                    this._map.update(existingKey);
                }
            } else if (!hasPending) {
                if (this._map.get(existingKey)._tryUpdatePending(null)) {
                    this._map.update(existingKey);
                }
            }
        }
    }

    get reactions() {
        return this._reactions;
    }

    getReaction(key) {
        return this._map.get(key);
    }
}

class ReactionViewModel {
    constructor(key, annotation, pending, parentTile) {
        this._key = key;
        this._annotation = annotation;
        this._pending = pending;
        this._parentTile = parentTile;
        this._isToggling = false;
    }

    _tryUpdate(annotation) {
        const oneSetAndOtherNot = !!this._annotation !== !!annotation;
        const bothSet = this._annotation && annotation;
        const areDifferent = bothSet &&  (
            annotation.me !== this._annotation.me ||
            annotation.count !== this._annotation.count ||
            annotation.firstTimestamp !== this._annotation.firstTimestamp
        );
        if (oneSetAndOtherNot || areDifferent) {
            this._annotation = annotation;
            return true;
        }
        return false;
    }

    _tryUpdatePending(pending) {
        if (!pending && !this._pending) {
            return false;
        }
        this._pending = pending;
        return true;
    }

    get key() {
        return this._key;
    }

    get count() {
        return (this._pending?.count || 0) + (this._annotation?.count || 0);
    }

    get isPending() {
        return this._pending !== null;
    }

    /** @returns {boolean} true if the user has a (pending) reaction
     *    already for this key, or they have a pending redaction for
     *    the reaction, false if there is nothing pending and
     *    the user has not reacted yet. */
    get isActive() {
        return this._annotation?.me || this.isPending;
    }

    get firstTimestamp() {
        let ts = Number.MAX_SAFE_INTEGER;
        if (this._annotation) {
            ts = Math.min(ts, this._annotation.firstTimestamp);
        }
        if (this._pending) {
            ts = Math.min(ts, this._pending.firstTimestamp);
        }
        return ts;
    }

    _compare(other) {
        // the comparator is also used to test for equality by sortValues, if the comparison returns 0
        // given that the firstTimestamp isn't set anymore when the last reaction is removed,
        // the remove event wouldn't be able to find the correct index anymore. So special case equality.
        if (other === this) {
            return 0;
        }
        if (this.count !== other.count) {
            return other.count - this.count;
        } else {
            const cmp = this.firstTimestamp - other.firstTimestamp;
            if (cmp === 0) {
                return this.key < other.key ? -1 : 1;
            }
            return cmp;
        }
    }

    async toggle(log = null) {
        if (this._isToggling) {
            console.log("busy toggling reaction already");
            return;
        }
        this._isToggling = true;
        try {
            await this._parentTile.toggleReaction(this.key, log);
        } finally {
            this._isToggling = false;
        }
    }
}

// matrix classes uses in the integration test below
import {User} from "../../../../matrix/User.js";
import {SendQueue} from "../../../../matrix/room/sending/SendQueue.js";
import {Timeline} from "../../../../matrix/room/timeline/Timeline.js";
import {EventEntry} from "../../../../matrix/room/timeline/entries/EventEntry.js";
import {RelationWriter} from "../../../../matrix/room/timeline/persistence/RelationWriter.js";
import {FragmentIdComparer} from "../../../../matrix/room/timeline/FragmentIdComparer.js";
import {createAnnotation} from "../../../../matrix/room/timeline/relations.js";
// mocks
import {Clock as MockClock} from "../../../../mocks/Clock.js";
import {createMockStorage} from "../../../../mocks/Storage.js";
import {ListObserver} from "../../../../mocks/ListObserver.js";
import {createEvent, withTextBody, withContent} from "../../../../mocks/event.js";
import {NullLogItem, NullLogger} from "../../../../logging/NullLogger.js";
import {HomeServer as MockHomeServer} from "../../../../mocks/HomeServer.js";
// other imports
import {BaseMessageTile} from "./tiles/BaseMessageTile.js";
import {MappedList} from "../../../../observable/list/MappedList.js";
import {ObservableValue} from "../../../../observable/ObservableValue.js";
import {PowerLevels} from "../../../../matrix/room/timeline/PowerLevels.js";

export function tests() {
    const fragmentIdComparer = new FragmentIdComparer([]);
    const roomId = "$abc";
    const alice = "@alice:hs.tld";
    const bob = "@bob:hs.tld";
    const logger = new NullLogger();

    function findInIterarable(it, predicate) {
        let i = 0;
        for (const item of it) {
            if (predicate(item, i)) {
                return item;
            }
            i += 1;
        }
        throw new Error("not found");
    }

    function mapMessageEntriesToBaseMessageTile(timeline, queue) {
        const room = {
            id: roomId,
            sendEvent(eventType, content, attachments, log) {
                return queue.enqueueEvent(eventType, content, attachments, log);
            },
            sendRedaction(eventIdOrTxnId, reason, log) {
                return queue.enqueueRedaction(eventIdOrTxnId, reason, log);
            }
        };
        const tiles = new MappedList(timeline.entries, entry => {
            if (entry.eventType === "m.room.message") {
                return new BaseMessageTile({entry, room, timeline, platform: {logger}});
            }
            return null;
        }, (tile, params, entry) => tile?.updateEntry(entry, params));
        return tiles;
    }

    return {
        // these are more an integration test than unit tests,
        // but fully test the local echo when toggling and
        // the correct send queue modifications happen
        "toggling reaction with own remote reaction": async assert => {
            // 1. put message and reaction in storage
            const messageEvent = withTextBody("Dogs > Cats", createEvent("m.room.message", "!abc", bob));
            const myReactionEvent = withContent(createAnnotation(messageEvent.event_id, "🐶"), createEvent("m.reaction", "!def", alice));
            myReactionEvent.origin_server_ts = 5;
            const myReactionEntry = new EventEntry({event: myReactionEvent, roomId}, fragmentIdComparer);
            const relationWriter = new RelationWriter({roomId, ownUserId: alice, fragmentIdComparer});
            const storage = await createMockStorage();
            const txn = await storage.readWriteTxn([
                storage.storeNames.timelineEvents,
                storage.storeNames.timelineRelations,
                storage.storeNames.timelineFragments
            ]);
            txn.timelineFragments.add({id: 1, roomId});
            txn.timelineEvents.insert({fragmentId: 1, eventIndex: 2, event: messageEvent, roomId});
            txn.timelineEvents.insert({fragmentId: 1, eventIndex: 3, event: myReactionEvent, roomId});
            await relationWriter.writeRelation(myReactionEntry, txn, new NullLogItem());
            await txn.complete();
            // 2. setup queue & timeline
            const queue = new SendQueue({roomId, storage, hsApi: new MockHomeServer().api});
            const powerLevelsObservable = new ObservableValue(new PowerLevels({ ownUserId: alice, membership: "join" }));
            const timeline = new Timeline({roomId, storage, fragmentIdComparer,
                clock: new MockClock(), pendingEvents: queue.pendingEvents, powerLevelsObservable});
            // 3. load the timeline, which will load the message with the reaction
            await timeline.load(new User(alice), "join", new NullLogItem());
            const tiles = mapMessageEntriesToBaseMessageTile(timeline, queue);
            // 4. subscribe to the queue to observe, and the tiles (so we can safely iterate)
            const queueObserver = new ListObserver();
            queue.pendingEvents.subscribe(queueObserver);
            tiles.subscribe(new ListObserver());
            const messageTile = findInIterarable(tiles, e => !!e); // the other entries are mapped to null
            const reactionVM = messageTile.reactions.getReaction("🐶");
            // 5. test toggling
            // make sure the preexisting reaction is counted
            assert.equal(reactionVM.count, 1);
            // 5.1. unset reaction, should redact the pre-existing reaction
            await reactionVM.toggle();
            {
                assert.equal(reactionVM.count, 0);
                const {value: redaction, type} = await queueObserver.next();
                assert.equal("add", type);
                assert.equal(redaction.eventType, "m.room.redaction");
                assert.equal(redaction.relatedEventId, myReactionEntry.id);
                // SendQueue puts redaction in sending status, as it is first in the queue
                assert.equal("update", (await queueObserver.next()).type);
            }
            // 5.2. set reaction, should send a new reaction as the redaction is already sending
            await reactionVM.toggle();
            let reactionIndex;
            {
                assert.equal(reactionVM.count, 1);
                const {value: reaction, type, index} = await queueObserver.next();
                assert.equal("add", type);
                assert.equal(reaction.eventType, "m.reaction");
                assert.equal(reaction.relatedEventId, messageEvent.event_id);
                reactionIndex = index;
            }
            // 5.3. unset reaction, should abort the previous pending reaction as it hasn't started sending yet
            await reactionVM.toggle();
            {
                assert.equal(reactionVM.count, 0);
                const {index, type} = await queueObserver.next();
                assert.equal("remove", type);
                assert.equal(reactionIndex, index);
            }
        },
        "toggling reaction without own remote reaction": async assert => {
            // 1. put message in storage
            const messageEvent = withTextBody("Dogs > Cats", createEvent("m.room.message", "!abc", bob));
            const storage = await createMockStorage();

            const txn = await storage.readWriteTxn([
                storage.storeNames.timelineEvents,
                storage.storeNames.timelineFragments
            ]);
            txn.timelineFragments.add({id: 1, roomId});
            txn.timelineEvents.insert({fragmentId: 1, eventIndex: 2, event: messageEvent, roomId});
            await txn.complete();
            // 2. setup queue & timeline
            const queue = new SendQueue({roomId, storage, hsApi: new MockHomeServer().api});
            const powerLevelsObservable = new ObservableValue(new PowerLevels({ ownUserId: alice, membership: "join" }));
            const timeline = new Timeline({roomId, storage, fragmentIdComparer,
                clock: new MockClock(), pendingEvents: queue.pendingEvents, powerLevelsObservable});

            // 3. load the timeline, which will load the message with the reaction
            await timeline.load(new User(alice), "join", new NullLogItem());
            const tiles = mapMessageEntriesToBaseMessageTile(timeline, queue);
            // 4. subscribe to the queue to observe, and the tiles (so we can safely iterate)
            const queueObserver = new ListObserver();
            queue.pendingEvents.subscribe(queueObserver);
            tiles.subscribe(new ListObserver());
            const messageTile = findInIterarable(tiles, e => !!e); // the other entries are mapped to null
            // 5. test toggling
            assert.equal(messageTile.reactions, null);
            // 5.1. set reaction, should send a new reaction as there is none yet
            await messageTile.react("🐶");
            // now there should be a reactions view model
            const reactionVM = messageTile.reactions.getReaction("🐶");
            let reactionTxnId;
            {
                assert.equal(reactionVM.count, 1);
                const {value: reaction, type} = await queueObserver.next();
                assert.equal("add", type);
                assert.equal(reaction.eventType, "m.reaction");
                assert.equal(reaction.relatedEventId, messageEvent.event_id);
                // SendQueue puts reaction in sending status, as it is first in the queue
                assert.equal("update", (await queueObserver.next()).type);
                reactionTxnId = reaction.txnId;
            }
            // 5.2. unset reaction, should redact the previous pending reaction as it has started sending already
            let redactionIndex;
            await reactionVM.toggle();
            {
                assert.equal(reactionVM.count, 0);
                const {value: redaction, type, index} = await queueObserver.next();
                assert.equal("add", type);
                assert.equal(redaction.eventType, "m.room.redaction");
                assert.equal(redaction.relatedTxnId, reactionTxnId);
                redactionIndex = index;
            }
            // 5.3. set reaction, should abort the previous pending redaction as it hasn't started sending yet
            await reactionVM.toggle();
            {
                assert.equal(reactionVM.count, 1);
                const {index, type} = await queueObserver.next();
                assert.equal("remove", type);
                assert.equal(redactionIndex, index);
                redactionIndex = index;
            }
        },
    }
}
