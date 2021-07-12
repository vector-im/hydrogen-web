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

    normalize(idx) {
        /*
        map index from list to index in rendered range
        eg: if the index range of this._list is [0, 200] and we have rendered
        elements in range [50, 60] then index 50 in list must map to index 0
        in DOM tree/childInstance array.
        */
        return idx - this.topCount;
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

    _renderIfNeeded() {
        const range = this._getVisibleRange();
        const intersectRange = range.expand(this._overflowMargin);
        const renderRange = range.expand(this._overflowItems);
        const listHasChangedSize = !!this._renderRange && this._list.length !== this._renderRange.totalSize();
        // console.log("currentRange", range);
        // console.log("renderRange", renderRange);
        // console.log("intersectRange", intersectRange);
        // console.log("LastRenderedRange", this._renderRange);
        // only update render Range if the list has shrunk/grown and we need to adjust padding OR
        // if the new range + overflowMargin isn't contained by the old anymore
        if (listHasChangedSize || !this._renderRange || !this._renderRange.contains(intersectRange)) {
            console.log("New render change");
            console.log("scrollTop", this._parent.scrollTop);
            this._renderRange = renderRange;
            this._renderElementsInRange();
        }
    }

    _renderItems(items) {
        this._childInstances = [];
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
        Do we need to do more (like event throttling)?
        */
        this._parent.addEventListener("scroll", () => this._renderIfNeeded());
        this._renderIfNeeded();
        return this._parent;
    }

    update(attributes) {
        this._renderRange = null;
        super.update(attributes);
        this._renderIfNeeded();
    }

    loadList() {
        if (!this._list) { return; }
        this._subscription = this._list.subscribe(this);
        this._childInstances = [];
    }


    // If size of the list changes, re-render
    onAdd() {
        this._renderIfNeeded();
    }

    onRemove() {
        this._renderIfNeeded();
    }

    onUpdate(idx, value, params) {
        if (this._renderRange.containsIndex(idx)) {
            const normalizedIdx = this._renderRange.normalize(idx);
            super.onUpdate(normalizedIdx, value, params);
        }
    }
    
    recreateItem(idx, value) {
        if (this._renderRange.containsIndex(idx)) {
            super.recreateItem(idx, value)
        }
    }

    _renderAdditionalElement(fromIdx, toIdx) {
        const {topCount, renderCount} = this._renderRange;
        const childFromIndex = index => this._childCreator(this._list.get(index));
        if (toIdx < fromIdx) {
            // Element is moved up the list, so render element from top boundary
            const index = topCount;
            const child = childFromIndex(index);
            // Modify childInstances here
            this._root.insertBefore(mountView(child, this._mountArgs), this._root.firstChild);
        }
        else {
            // Element is moved down the list, so render element from bottom boundary
            const index = topCount + renderCount - 1;
            const child = childFromIndex(index);
            this._root.appendChild(mountView(child, this._mountArgs));
        }
    }

    _removeAdditionalElement(fromIdx, toIdx) {
        if (toIdx < fromIdx) {
            // Element comes from the bottom, so remove element at bottom
            this._root.lastChild.remove();
        }
        else {
            this._root.firstChild.remove();
        }
    }

    onMove(fromIdx, toIdx, value) {
        const fromInRange = this._renderRange.containsIndex(fromIdx);
        const toInRange = this._renderRange.containsIndex(toIdx);
        const normalizedFromIdx = this._renderRange.normalize(fromIdx);
        const normalizedToIdx = this._renderRange.normalize(toIdx);
        if (fromInRange && toInRange) {
            super.onMove(normalizedFromIdx, normalizedToIdx, value);
        }
        else if (fromInRange && !toInRange) {
            this.onBeforeListChanged();
            const [child] = this._childInstances.splice(normalizedFromIdx, 1);
            child.root().remove();
            this._renderAdditionalElement(fromIdx, toIdx);
            this.onListChanged();
        }
        else if (!fromInRange && toInRange) {
            this.onBeforeListChanged();
            const child = this._childCreator(value);
            this._childInstances.splice(normalizedToIdx, 0, child);
            this._removeAdditionalElement(fromIdx, toIdx);
            insertAt(this._root, normalizedToIdx, mountView(child, this._mountArgs));
            this.onListChanged();
        }
    }

}
