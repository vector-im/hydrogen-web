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

import {el} from "./html.js";
import {mountView} from "./utils.js";

export function insertAt(parentNode, idx, childNode) {
    const isLast = idx === parentNode.childElementCount;
    if (isLast) {
        parentNode.appendChild(childNode);
    } else {
        const nextDomNode = parentNode.children[idx];
        parentNode.insertBefore(childNode, nextDomNode);
    }
}

export class ListView {
    constructor({list, onItemClick, className, tagName = "ul", parentProvidesUpdates = true}, childCreator) {
        this._onItemClick = onItemClick;
        this._list = list;
        this._className = className;
        this._tagName = tagName;
        this._root = null;
        this._subscription = null;
        this._childCreator = childCreator;
        this._childInstances = null;
        this._mountArgs = {parentProvidesUpdates};
        this._onClick = this._onClick.bind(this);
    }

    root() {
        return this._root;
    }

    update(attributes) {
        if (attributes.hasOwnProperty("list")) {
            if (this._subscription) {
                this._unloadList();
                while (this._root.lastChild) {
                    this._root.lastChild.remove();
                }
            }
            this._list = attributes.list;
            this.loadList();
        }
    }

    mount() {
        const attr = {};
        if (this._className) {
            attr.className = this._className;
        }
        this._root = el(this._tagName, attr);
        this.loadList();
        if (this._onItemClick) {
            this._root.addEventListener("click", this._onClick);
        }
        return this._root;
    }

    unmount() {
        if (this._list) {
            this._unloadList();
        }
    }

    _onClick(event) {
        if (event.target === this._root) {
            return;
        }
        let childNode = event.target;
        while (childNode.parentNode !== this._root) {
            childNode = childNode.parentNode;
        }
        const index = Array.prototype.indexOf.call(this._root.childNodes, childNode);
        const childView = this._childInstances[index];
        this._onItemClick(childView, event);
    }

    _unloadList() {
        this._subscription = this._subscription();
        for (let child of this._childInstances) {
            child.unmount();
        }
        this._childInstances = null;
    }

    loadList() {
        if (!this._list) {
            return;
        }
        this._subscription = this._list.subscribe(this);
        this._childInstances = [];
        const fragment = document.createDocumentFragment();
        for (let item of this._list) {
            const child = this._childCreator(item);
            this._childInstances.push(child);
            fragment.appendChild(mountView(child, this._mountArgs));
        }
        this._root.appendChild(fragment);
    }

    onAdd(idx, value) {
        this.onBeforeListChanged();
        const child = this._childCreator(value);
        this._childInstances.splice(idx, 0, child);
        insertAt(this._root, idx, mountView(child, this._mountArgs));
        this.onListChanged();
    }

    onRemove(idx, _value) {
        this.onBeforeListChanged();
        const [child] = this._childInstances.splice(idx, 1);
        child.root().remove();
        child.unmount();
        this.onListChanged();
    }

    onMove(fromIdx, toIdx, value) {
        this.onBeforeListChanged();
        const [child] = this._childInstances.splice(fromIdx, 1);
        this._childInstances.splice(toIdx, 0, child);
        child.root().remove();
        insertAt(this._root, toIdx, child.root());
        this.onListChanged();
    }

    onUpdate(i, value, params) {
        if (this._childInstances) {
            const instance = this._childInstances[i];
            instance && instance.update(value, params);
        }
    }

    recreateItem(index, value) {
        if (this._childInstances) {
            const child = this._childCreator(value);
            if (!child) {
                this.onRemove(index, value);
            } else {
                const [oldChild] = this._childInstances.splice(index, 1, child);
                this._root.replaceChild(child.mount(this._mountArgs), oldChild.root());
                oldChild.unmount();
            }
        }
    }

    onBeforeListChanged() {}
    onListChanged() {}
}
