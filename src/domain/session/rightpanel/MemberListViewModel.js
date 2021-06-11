import {ViewModel} from "../../ViewModel.js";
import {MemberTileViewModel} from "./MemberTileViewModel.js";

function comparator(member, otherMember) {
    return member.displayName?.localeCompare(otherMember.displayName);
}

export class MemberListViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this.memberTileViewModels = this._mapTileViewModels(this._filterJoinedMembers(options.members))
                                        .sortValues(comparator);
    }

    _filterJoinedMembers(members) {
        return members.filterValues(member => member.membership === "join");
    }

    _mapTileViewModels(members) {
        return members.mapValues((member, emitChange) => {
            return new MemberTileViewModel(this.childOptions({member, emitChange}));
        });
    }
}
