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

import {BaseObservableMap} from "./BaseObservableMap.js";

export class FilteredMap extends BaseObservableMap {
    constructor(source, filter) {
        super();
        this._source = source;
        this._filter = filter;
        /** @type {Map<string, bool>} */
        this._included = null;
        this._subscription = null;
    }

    setFilter(filter) {
        this._filter = filter;
        if (this._subscription) {
            this._reapplyFilter();
        }
    }

    /**
     * reapply the filter
     */
    _reapplyFilter(silent = false) {
        if (this._filter) {
            const oldIncluded = this._included;
            this._included = this._included || new Map();
            for (const [key, value] of this._source) {
                const isIncluded = this._filter(value, key);
                this._included.set(key, isIncluded);
                if (!silent) {
                    const wasIncluded = oldIncluded ? oldIncluded.get(key) : true;
                    this._emitForUpdate(wasIncluded, isIncluded, key, value);
                }
            }
        } else { // no filter
            // did we have a filter before?
            if (this._included && !silent) {
                // add any non-included items again
                for (const [key, value] of this._source) {
                    if (!this._included.get(key)) {
                        this.emitAdd(key, value);
                    }
                }
            }
            this._included = null;
        }
    }

    onAdd(key, value) {
        if (this._filter) {
            const included = this._filter(value, key);
            this._included.set(key, included);
            if (!included) {
                return;
            }
        }
        this.emitAdd(key, value);
    }

    onRemove(key, value) {
        const wasIncluded = !this._filter || this._included.get(key);
        this._included.delete(key);
        if (wasIncluded) {
            this.emitRemove(key, value);
        }
    }

    onUpdate(key, value, params) {
        // if an update is emitted while calling source.subscribe() from onSubscribeFirst, ignore it
        if (!this._included) {
            return;
        }
        if (this._filter) {
            const wasIncluded = this._included.get(key);
            const isIncluded = this._filter(value, key);
            this._included.set(key, isIncluded);
            this._emitForUpdate(wasIncluded, isIncluded, key, value, params);
        } else {
            this.emitUpdate(key, value, params);
        }
    }

    _emitForUpdate(wasIncluded, isIncluded, key, value, params = null) {
        if (wasIncluded && !isIncluded) {
            this.emitRemove(key, value);
        } else if (!wasIncluded && isIncluded) {
            this.emitAdd(key, value);
        } else if (wasIncluded && isIncluded) {
            this.emitUpdate(key, value, params);
        }
    }

    onSubscribeFirst() {
        this._subscription = this._source.subscribe(this);
        this._reapplyFilter(true);
        super.onSubscribeFirst();
    }

    onUnsubscribeLast() {
        super.onUnsubscribeLast();
        this._included = null;
        this._subscription = this._subscription();
    }

    onReset() {
        this._reapplyFilter();
        this.emitReset();
    }

    [Symbol.iterator]() {
        return new FilterIterator(this._source, this._included);
    }

    get size() {
        let count = 0;
        this._included.forEach(included => {
            if (included) {
                count += 1;
            }
        });
        return count;
    }

    get(key) {
        const value = this._source.get(key);
        if (value && this._filter(value, key)) {
            return value;
        }
    }
}

class FilterIterator {
    constructor(map, _included) {
        this._included = _included;
        this._sourceIterator = map[Symbol.iterator]();
    }

    next() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const sourceResult = this._sourceIterator.next();
            if (sourceResult.done) {
                return sourceResult;
            }
            const key = sourceResult.value[0];
            if (this._included.get(key)) {
                return sourceResult;
            }
        }
    }
}

import {ObservableMap} from "./ObservableMap.js";
export function tests() {
    return {
        "filter preloaded list": assert => {
            const source = new ObservableMap();
            source.add("one", 1);
            source.add("two", 2);
            source.add("three", 3);
            const oddNumbers = new FilteredMap(source, x => x % 2 !== 0);
            // can only iterate after subscribing
            oddNumbers.subscribe({});
            assert.equal(oddNumbers.size, 2);
            const it = oddNumbers[Symbol.iterator]();
            assert.deepEqual(it.next().value, ["one", 1]);
            assert.deepEqual(it.next().value, ["three", 3]);
            assert.equal(it.next().done, true);
        },
        // "filter added values": assert => {

        // },
        // "filter removed values": assert => {

        // },
        // "filter changed values": assert => {

        // },

        "emits must trigger once": assert => {
            const source = new ObservableMap();
            let count_add = 0, count_update = 0, count_remove = 0;
            source.add("num1", 1);
            source.add("num2", 2);
            source.add("num3", 3);
            const oddMap = new FilteredMap(source, x => x % 2 !== 0);
            oddMap.subscribe({
                onAdd() {
                    count_add += 1;
                },
                onRemove() {
                    count_remove += 1;
                },
                onUpdate() {
                    count_update += 1;
                }
            });
            source.set("num3", 4);
            source.set("num3", 5);
            source.set("num3", 7);
            assert.strictEqual(count_add, 1);
            assert.strictEqual(count_update, 1);
            assert.strictEqual(count_remove, 1);
        }
    }
}
