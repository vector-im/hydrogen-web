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
/*
so a mapped value can emit updates on it's own with this._emitSpontaneousUpdate that is passed in the mapping function
how should the mapped value be notified of an update though? and can it then decide to not propagate the update?
*/
export class MappedMap extends BaseObservableMap {
    constructor(source, mapper, updater) {
        super();
        this._source = source;
        this._mapper = mapper;
        this._updater = updater;
        this._mappedValues = new Map();
    }

    _emitSpontaneousUpdate(key, params) {
        const value = this._mappedValues.get(key);
        if (value) {
            this.emitUpdate(key, value, params);
        }
    }

    onAdd(key, value) {
        const emitSpontaneousUpdate = this._emitSpontaneousUpdate.bind(this, key);
        const mappedValue = this._mapper(value, emitSpontaneousUpdate);
        this._mappedValues.set(key, mappedValue);
        this.emitAdd(key, mappedValue);
    }

    onRemove(key, _value) {
        const mappedValue = this._mappedValues.get(key);
        if (this._mappedValues.delete(key)) {
            this.emitRemove(key, mappedValue);
        }
    }

    onUpdate(key, value, params) {
        // if an update is emitted while calling source.subscribe() from onSubscribeFirst, ignore it
        if (!this._mappedValues) {
            return;
        }
        const mappedValue = this._mappedValues.get(key);
        if (mappedValue !== undefined) {
            this._updater?.(mappedValue, params, value);
            // TODO: map params somehow if needed?
            this.emitUpdate(key, mappedValue, params);
        }
    }

    onSubscribeFirst() {
        this._subscription = this._source.subscribe(this);
        for (let [key, value] of this._source) {
            const emitSpontaneousUpdate = this._emitSpontaneousUpdate.bind(this, key);
            const mappedValue = this._mapper(value, emitSpontaneousUpdate);
            this._mappedValues.set(key, mappedValue);
        }
        super.onSubscribeFirst();
    }

    onUnsubscribeLast() {
        super.onUnsubscribeLast();
        this._subscription = this._subscription();
        this._mappedValues.clear();
    }

    onReset() {
        this._mappedValues.clear();
        this.emitReset();
    }

    [Symbol.iterator]() {
        return this._mappedValues.entries();
    }

    get size() {
        return this._mappedValues.size;
    }

    get(key) {
        return this._mappedValues.get(key);
    }
}
