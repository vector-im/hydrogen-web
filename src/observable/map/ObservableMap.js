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

export class ObservableMap extends BaseObservableMap {
    constructor(initialValues) {
        super();
        this._values = new Map(initialValues);
    }

    update(key, params) {
        const value = this._values.get(key);
        if (value !== undefined) {
            // could be the same value, so it's already updated
            // but we don't assume this here
            this._values.set(key, value);
            this.emitUpdate(key, value, params);
            return true;
        }
        return false;   // or return existing value?
    }

    add(key, value) {
        if (!this._values.has(key)) {
            this._values.set(key, value);
            this.emitAdd(key, value);
            return true;
        }
        return false;   // or return existing value?
    }

    remove(key) {
        const value = this._values.get(key);
        if (value !== undefined) {
            this._values.delete(key);
            this.emitRemove(key, value);
            return true;
        } else {
            return false;
        }
    }

    set(key, value) {
        if (this._values.has(key)) {
            // We set the value here because update only supports inline updates
            this._values.set(key, value);
            return this.update(key);
        }    
        else {
            return this.add(key, value);
        }
    }

    reset() {
        this._values.clear();
        this.emitReset();
    }

    get(key) {
        return this._values.get(key);
    }

    get size() {
        return this._values.size;
    }

    [Symbol.iterator]() {
        return this._values.entries();
    }

    values() {
        return this._values.values();
    }

    keys() {
        return this._values.keys();
    }
}

export function tests() {
    return {
        test_initial_values(assert) {
            const map = new ObservableMap([
                ["a", 5],
                ["b", 10]
            ]);
            assert.equal(map.size, 2);
            assert.equal(map.get("a"), 5);
            assert.equal(map.get("b"), 10);
        },

        test_add(assert) {
            let fired = 0;
            const map = new ObservableMap();
            map.subscribe({
                onAdd(key, value) {
                    fired += 1;
                    assert.equal(key, 1);
                    assert.deepEqual(value, {value: 5}); 
                }
            });
            map.add(1, {value: 5});
            assert.equal(map.size, 1);
            assert.equal(fired, 1);
        },

        test_update(assert) {
            let fired = 0;
            const map = new ObservableMap();
            const value = {number: 5};
            map.add(1, value);
            map.subscribe({
                onUpdate(key, value, params) {
                    fired += 1;
                    assert.equal(key, 1);
                    assert.deepEqual(value, {number: 6}); 
                    assert.equal(params, "test");
                }
            });
            value.number = 6;
            map.update(1, "test");
            assert.equal(fired, 1);
        },

        test_update_unknown(assert) {
            let fired = 0;
            const map = new ObservableMap();
            map.subscribe({
                onUpdate() { fired += 1; }
            });
            const result = map.update(1);
            assert.equal(fired, 0);
            assert.equal(result, false);
        },

        test_set(assert) {
            let add_fired = 0, update_fired = 0;
            const map = new ObservableMap();
            map.subscribe({
                onAdd(key, value) {
                    add_fired += 1;
                    assert.equal(key, 1);
                    assert.deepEqual(value, {value: 5}); 
                },
                onUpdate(key, value, params) {
                    update_fired += 1;
                    assert.equal(key, 1);
                    assert.deepEqual(value, {value: 7}); 
                }
            });
            // Add
            map.set(1, {value: 5});
            assert.equal(map.size, 1);
            assert.equal(add_fired, 1);
            // Update
            map.set(1, {value: 7});
            assert.equal(map.size, 1);
            assert.equal(update_fired, 1);
        },

        test_remove(assert) {
            let fired = 0;
            const map = new ObservableMap();
            const value = {value: 5};
            map.add(1, value);
            map.subscribe({
                onRemove(key, value) {
                    fired += 1;
                    assert.equal(key, 1);
                    assert.deepEqual(value, {value: 5}); 
                }
            });
            map.remove(1);
            assert.equal(map.size, 0);
            assert.equal(fired, 1);
        },

        test_iterate(assert) {
            const results = [];
            const map = new ObservableMap();
            map.add(1, {number: 5});
            map.add(2, {number: 6});
            map.add(3, {number: 7});
            for (let e of map) {
                results.push(e);
            }
            assert.equal(results.length, 3);
            assert.equal(results.find(([key]) => key === 1)[1].number, 5);
            assert.equal(results.find(([key]) => key === 2)[1].number, 6);
            assert.equal(results.find(([key]) => key === 3)[1].number, 7);
        },
        test_size(assert) {
            const map = new ObservableMap();
            map.add(1, {number: 5});
            map.add(2, {number: 6});
            assert.equal(map.size, 2);
        },
    }
}
