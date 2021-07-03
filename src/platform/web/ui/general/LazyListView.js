import {mountView} from "./utils.js";
import {insertAt, ListView} from "./ListView.js";

class Range {
    constructor(start = 0, end = 0) {
        this.start = start;
        this.end = end;
        this._expanded = false;
    }

    _onInitialExpand() {
        if (this._expanded) { return; }
        this._initialStart = this.start;
        this._expanded = true;
    }

    expandFromEnd(units) {
        this._onInitialExpand();
        this.start = this.end;
        this.end += units;
        this._expanded = true;
    }

    contains(idx) {
        const start = this._expanded ? this._initialStart : this.start;
        return idx >= start && idx <= this.end;
    }
}

export class LazyListView extends ListView {
    constructor({itemHeight, height, appendCount = 5, ...options}, childCreator) {
        super(options, childCreator);
        this._itemHeight = itemHeight;
        this._height = height;
        this._appendCount = appendCount;
        this._range = new Range();
    }

    _isFullyScrolled() {
        return this._root.scrollHeight - Math.abs(this._root.scrollTop) === this._root.clientHeight;
    }

    _renderMoreIfNeeded() {
        if (!this._isFullyScrolled()) {
            return;
        }
        this._range.expandFromEnd(this._appendCount);
        this._renderElementsInRange();
    }

    _renderElementsInRange() {
        const items = this._list.slice(this._range.start, this._range.end);
        const fragment = document.createDocumentFragment();
        for (const item of items) {
            const view = this._childCreator(item.value);
            this._childInstances.push(view);
            fragment.appendChild(mountView(view, this._mountArgs));
        }
        this._root.appendChild(fragment);
    }

    _calculateInitialRenderCount() {
        return Math.ceil(this._height / this._itemHeight);
    }

    loadList() {
        if (!this._list) {
            return;
        }
        this._subscription = this._list.subscribe(this);
        this._range.end = this._calculateInitialRenderCount() + this._appendCount;
        this._childInstances = [];
        this._renderElementsInRange();
        /*
        Hooking to scroll events can be expensive.
        But in most of these scroll events, we return early.
        Do we need to do more (like event throttling)?
        */
        this._root.addEventListener("scroll", () => this._renderMoreIfNeeded());
    }

    // onAdd, onRemove, ... should be called only if the element is already rendered
    onAdd(idx, value) {
        if (this._range.contains(idx)) {
            super.onAdd(idx, value);
        }
    }

    onRemove(idx, value) {
        if (this._range.contains(idx)) {
            super.onRemove(idx, value);
        }
    }

    onUpdate(idx, value, params) {
        if (this._range.contains(idx)) {
            super.onUpdate(idx, value, params);
        }
    }
    
    recreateItem(idx, value) {
        if (this._range.contains(idx)) {
            super.recreateItem(idx, value)
        }
    }

    onMove(fromIdx, toIdx, value) {
        const fromInRange = this._range.contains(fromIdx);
        const toInRange = this._range.contains(toIdx);
        if (fromInRange && toInRange) {
            super.onMove(fromIdx, toIdx, value);
        }
        else if (fromInRange && !toInRange) {
            this.onBeforeListChanged();
            const [child] = this._childInstances.splice(fromIdx, 1);
            child.root().remove();
            this.onListChanged();
        }
        else if (!fromInRange && toInRange) {
            this.onBeforeListChanged();
            const child = this._childCreator(value);
            this._childInstances.splice(toIdx, 0, child);
            insertAt(this._root, toIdx, mountView(child, this._mountArgs));
            this.onListChanged();
        }
    }

}
