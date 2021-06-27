export class Disambiguator {
    constructor() {
        this._map = new Map();
    }

    _flatten(name, array) {
        const vm = array.pop();
        vm.setDisambiguation(false);
        this._map.set(name, vm);
    }

    _unDisambiguate(vm, array) {
        const idx = array.indexOf(vm);
        if (idx !== -1) {
            const [removed] = array.splice(idx, 1);
            removed.setDisambiguation(false);
        }
    }

    async _handlePreviousName(vm) {
        const previousName = vm.previousName;
        if (!previousName) { return; }
        const value = this._map.get(previousName);
        if (Array.isArray(value)) {
            this._unDisambiguate(vm, value);
            if (value.length === 1) { this._flatten(previousName, value); }
        } else {
            this._map.delete(previousName);
        }
    }

    async _updateMap(vm) {
        const name = vm.name;
        if (this._map.has(name)) {
            const value = this._map.get(name);
            if (Array.isArray(value)) {
                value.push(vm);
            } else {
                this._map.set(name, [value, vm]);
            }
        } else {
            this._map.set(name, vm);
        }
    }

    async disambiguate(vm) {
        if (!vm.nameChanged) { return; }
        await this._handlePreviousName(vm);
        await this._updateMap(vm);
        const value = this._map.get(vm.name);
        if (Array.isArray(value)) {
            value.forEach((vm) => vm.setDisambiguation(true));
        }
    }
}

export function tests(){

    class MockViewModel {
        constructor(name, userId) {
            this.name = name;
            this.disambiguate = false;
            this.userId = userId;
            this.nameChanged = true;
        }
        
        updateName(newName) {
            if (this.name !== newName) {
                this.previousName = this.name;
                this.nameChanged = true;
            }
            else {
                this.nameChanged = false;
            }
            this.name = newName;
        }

        setDisambiguation(status) {
            this.disambiguate = status;
        }
    }

    function createVmAndDisambiguator(nameList) {
        const d = new Disambiguator();
        const array = nameList.map(([name, id]) => new MockViewModel(name, id));
        return [...array, d];
    }

    return {
        "Unique names": async assert => {
            const [vm1, vm2, d] = createVmAndDisambiguator([["foo", "a"], ["bar", "b"]]);
            await d.disambiguate(vm1);
            await d.disambiguate(vm2);
            assert.strictEqual(vm1.disambiguate, false);
            assert.strictEqual(vm2.disambiguate, false);
        },

        "Same names are disambiguated": async assert => {
            const [vm1, vm2, vm3, d] = createVmAndDisambiguator([["foo", "a"], ["foo", "b"], ["foo", "c"]]);
            await d.disambiguate(vm1);
            await d.disambiguate(vm2);
            await d.disambiguate(vm3);
            assert.strictEqual(vm1.disambiguate, true);
            assert.strictEqual(vm2.disambiguate, true);
            assert.strictEqual(vm3.disambiguate, true);
        },

        "Name updates disambiguate": async assert => {
            const [vm1, vm2, vm3, d] = createVmAndDisambiguator([["foo", "a"], ["bar", "b"], ["jar", "c"]]);
            await d.disambiguate(vm1);
            await d.disambiguate(vm2);
            await d.disambiguate(vm3);
            
            vm2.updateName("foo");
            await d.disambiguate(vm2);
            assert.strictEqual(vm1.disambiguate, true);
            assert.strictEqual(vm2.disambiguate, true);

            vm1.updateName("bar");
            await d.disambiguate(vm1);
            assert.strictEqual(vm1.disambiguate, false);
            assert.strictEqual(vm2.disambiguate, false);

            vm3.updateName("foo");
            await d.disambiguate(vm3);
            vm1.updateName("foo");
            await d.disambiguate(vm1);
            assert.strictEqual(vm1.disambiguate, true);
            assert.strictEqual(vm2.disambiguate, true);
            assert.strictEqual(vm3.disambiguate, true);

            vm2.updateName("bar");
            await d.disambiguate(vm2);
            assert.strictEqual(vm1.disambiguate, true);
            assert.strictEqual(vm2.disambiguate, false);
            assert.strictEqual(vm3.disambiguate, true);
        },

        "Multiple disambiguate events": async assert => {
            const [vm1, d] = createVmAndDisambiguator([["foo", "a"]]);
            await d.disambiguate(vm1);
            vm1.updateName(vm1.name);
            await d.disambiguate(vm1);
            assert.strictEqual(vm1.disambiguate, false);
        },
    };
}