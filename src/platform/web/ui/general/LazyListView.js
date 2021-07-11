import {el} from "./html.js";
import {mountView} from "./utils.js";
import {insertAt, ListView} from "./ListView.js";

class ItemRange {
    constructor(topCount, renderCount, bottomCount) {
        this.topCount = topCount;
        this.renderCount = renderCount;
        this.bottomCount = bottomCount;
    }

    contains(range) {
        // don't contain empty ranges
        // as it will prevent clearing the list
        // once it is scrolled far enough out of view
        if (!range.renderCount && this.renderCount) {
            return false;
        }
        return range.topCount >= this.topCount &&
            (range.topCount + range.renderCount) <= (this.topCount + this.renderCount);
    }

    containsIndex(idx) {
        return idx >= this.topCount && idx <= (this.topCount + this.renderCount);
    }

    expand(amount) {
        // don't expand ranges that won't render anything
        if (this.renderCount === 0) {
            return this;
        }

        const topGrow = Math.min(amount, this.topCount);
        const bottomGrow = Math.min(amount, this.bottomCount);
        return new ItemRange(
            this.topCount - topGrow,
            this.renderCount + topGrow + bottomGrow,
            this.bottomCount - bottomGrow,
        );
    }

    totalSize() {
        return this.topCount + this.renderCount + this.bottomCount;
    }
}

export class LazyListView extends ListView {
    constructor({itemHeight, height, ...options}, childCreator) {
        super(options, childCreator);
        this._itemHeight = itemHeight;
        this._height = height;
        this._overflowMargin = 5;
        this._overflowItems = 20;
    }

    _getVisibleRange() {
        const length = this._list ? this._list.length : 0;
        const scrollTop = this._parent.scrollTop;
        const topCount = Math.min(Math.max(0, Math.floor(scrollTop / this._itemHeight)), length);
        const itemsAfterTop = length - topCount;
        const visibleItems = this._height !== 0 ? Math.ceil(this._height / this._itemHeight) : 0;
        const renderCount = Math.min(visibleItems, itemsAfterTop);
        const bottomCount = itemsAfterTop - renderCount;
        return new ItemRange(topCount, renderCount, bottomCount);
    }

    _renderMoreIfNeeded() {
        const range = this._getVisibleRange();
        const intersectRange = range.expand(this._overflowMargin);
        const renderRange = range.expand(this._overflowItems);
        const listHasChangedSize = !!this._renderRange && this._list.length !== this._renderRange.totalSize();
        console.log("currentRange", range);
        console.log("renderRange", renderRange);
        console.log("intersectRange", intersectRange);
        console.log("LastRenderedRange", this._renderRange);
        // only update render Range if the list has shrunk/grown and we need to adjust padding OR
        // if the new range + overflowMargin isn't contained by the old anymore
        if (listHasChangedSize || !this._renderRange || !this._renderRange.contains(intersectRange)) {
            console.log("New render change");
            this._renderRange = renderRange;
            this._renderElementsInRange();
        }
    }

    _renderItems(items) {
        const fragment = document.createDocumentFragment();
        for (const item of items) {
            const view = this._childCreator(item.value);
            this._childInstances.push(view);
            fragment.appendChild(mountView(view, this._mountArgs));
        }
        this._root.appendChild(fragment);
    }

    _renderElementsInRange() {
        const { topCount, renderCount, bottomCount } = this._renderRange;
        const paddingTop = topCount * this._itemHeight;
        const paddingBottom = bottomCount * this._itemHeight;
        const renderedItems = (this._list || []).slice(
            topCount,
            topCount + renderCount,
        );
        this._root.style.paddingTop = `${paddingTop}px`;
        this._root.style.paddingBottom = `${paddingBottom}px`;
        this._root.innerHTML = "";
        this._renderItems(renderedItems);
    }

    mount() {
        const root = super.mount();
        this._parent = el("div", {className: "LazyListParent"}, root);
        /*
        Hooking to scroll events can be expensive.
        But in most of these scroll events, we return early.
        Do we need to do more (like event throttling)?
        */
        this._parent.addEventListener("scroll", () => this._renderMoreIfNeeded());
        this._renderMoreIfNeeded();
        return this._parent;
    }

    loadList() {
        if (!this._list) { return; }
        this._subscription = this._list.subscribe(this);
        this._childInstances = [];
    }

    // onAdd, onRemove, ... should be called only if the element is already rendered
    onAdd() {
        this._renderMoreIfNeeded();
    }

    onRemove() {
        this._renderMoreIfNeeded();
    }

    onUpdate(idx, value, params) {
        console.log("onUpdate");
        if (this._renderRange.containsIndex(idx)) {
            super.onUpdate(idx, value, params);
        }
    }
    
    recreateItem(idx, value) {
        console.log("recreateItem");
        if (this._renderRange.containsIndex(idx)) {
            super.recreateItem(idx, value)
        }
    }

    onMove(fromIdx, toIdx, value) {
        console.log("onMove");
        const fromInRange = this._renderRange.containsIndex(fromIdx);
        const toInRange = this._renderRange.containsIndex(toIdx);
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
