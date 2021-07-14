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

import {SortedMapList} from "./list/SortedMapList.js";
import {FilteredMap} from "./map/FilteredMap.js";
import {MappedMap} from "./map/MappedMap.js";
import {JoinedMap} from "./map/JoinedMap.js";
import {BaseObservableMap} from "./map/BaseObservableMap.js";
// re-export "root" (of chain) collections
export { ObservableArray } from "./list/ObservableArray.js";
export { SortedArray } from "./list/SortedArray.js";
export { MappedList } from "./list/MappedList.js";
export { AsyncMappedList } from "./list/AsyncMappedList.js";
export { ConcatList } from "./list/ConcatList.js";
export { ObservableMap } from "./map/ObservableMap.js";

// avoid circular dependency between these classes
// and BaseObservableMap (as they extend it)
Object.assign(BaseObservableMap.prototype, {
    sortValues(comparator) {
        return new SortedMapList(this, comparator);
    },

    mapValues(mapper, updater) {
        return new MappedMap(this, mapper, updater);
    },

    filterValues(filter) {
        return new FilteredMap(this, filter);
    },

    join(...otherMaps) {
        return new JoinedMap([this].concat(otherMaps));
    }
});
