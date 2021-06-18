import {PowerLevels} from "../../../matrix/room/timeline/PowerLevels.js";

export function createMemberComparator(powerLevels) {
    return function comparator(member, otherMember) {
        const p1 = powerLevels.getUserLevel(member.userId);
        const p2 = powerLevels.getUserLevel(otherMember.userId);
        if (p1 !== p2) { return p2 - p1; }
        return member.displayName?.localeCompare(otherMember.displayName);
    };
}

export function tests() {

    function createComparatorWithPowerLevel(map) {
        let users = {};
        for (const prop in map) {
            Object.assign(users, {[prop]: map[prop]});
        }
        const powerLevelEvent = {
            content: {users, users_default: 0}
        };
        return createMemberComparator(new PowerLevels({powerLevelEvent}));
    }

    return {
        "power_level(member1) > power_level(member2) returns value <= 0": assert => {
            const fn = createComparatorWithPowerLevel({"@alice:hs.tld": 50});
            const member1 = {userId: "@alice:hs.tld", displayName: "alice"};
            const member2 = {userId: "@bob:hs.tld", displayName: "bob"};
            assert.strictEqual(fn(member1, member2) <= 0, true);
        },

        "power_level(member1) < power_level(member2) returns value > 0": assert => {
            const fn = createComparatorWithPowerLevel({"@alice:hs.tld": 50});
            const member1 = {userId: "@bob:hs.tld", displayName: "bob"};
            const member2 = {userId: "@alice:hs.tld", displayName: "alice"};
            assert.strictEqual(fn(member1, member2) > 0, true);
        },

        "alphabetic compare on displayName": assert => {
            const fn = createComparatorWithPowerLevel();
            const member1 = {userId: "@bob:hs.tld", displayName: "bob"};
            const member2 = {userId: "@alice:hs.tld", displayName: "alice"};
            assert.strictEqual(fn(member1, member2) > 0, true);
            assert.strictEqual(fn(member2, member1) <= 0, true);
        },

        "alphabetic compare with case (alice comes before Bob)": assert => {
            const fn = createComparatorWithPowerLevel();
            const member1 = {userId: "@bob:hs.tld", displayName: "Bob"};
            const member2 = {userId: "@alice:hs.tld", displayName: "alice"};
            assert.strictEqual(fn(member1, member2) > 0, true);
            assert.strictEqual(fn(member2, member1) <= 0, true);
        },

        "equal powerlevel and same names returns 0": assert => {
            const fn = createComparatorWithPowerLevel({"@bobby:hs.tld": 50, "@bob:hs.tld": 50});
            const member1 = {userId: "@bob:hs.tld", displayName: "bob"};
            const member2 = {userId: "@bobby:hs.tld", displayName: "bob"};
            assert.strictEqual(fn(member1, member2), 0);
            assert.strictEqual(fn(member2, member1), 0);
        },

        "(both_negative_powerlevel) power_level(member1) < power_level(member2) returns value > 0": assert => {
            const fn = createComparatorWithPowerLevel({"@alice:hs.tld": -100, "@bob:hs.tld": -50});
            const member1 = {userId: "@alice:hs.tld", displayName: "alice"};
            const member2 = {userId: "@bob:hs.tld", displayName: "bob"};
            assert.strictEqual(fn(member1, member2) > 0, true);
        },

        "(both_negative_powerlevel) power_level(member1) > power_level(member2) returns value <= 0": assert => {
            const fn = createComparatorWithPowerLevel({"@alice:hs.tld": -50, "@bob:hs.tld": -100});
            const member1 = {userId: "@alice:hs.tld", displayName: "alice"};
            const member2 = {userId: "@bob:hs.tld", displayName: "bob"};
            assert.strictEqual(fn(member1, member2) <= 0, true);
        },

        "(one_negative_powerlevel) power_level(member1) > power_level(member2) returns value <= 0": assert => {
            const fn = createComparatorWithPowerLevel({"@alice:hs.tld": 50, "@bob:hs.tld": -100});
            const member1 = {userId: "@alice:hs.tld", displayName: "alice"};
            const member2 = {userId: "@bob:hs.tld", displayName: "bob"};
            assert.strictEqual(fn(member1, member2) <= 0, true);
        },

        "(one_negative_powerlevel) power_level(member1) < power_level(member2) returns value > 0": assert => {
            const fn = createComparatorWithPowerLevel({"@alice:hs.tld": -100, "@bob:hs.tld": 50});
            const member1 = {userId: "@alice:hs.tld", displayName: "alice"};
            const member2 = {userId: "@bob:hs.tld", displayName: "bob"};
            assert.strictEqual(fn(member1, member2) > 0, true);
        },
    };
}
