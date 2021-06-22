import {ViewModel} from "../../ViewModel.js";
import {MemberTileViewModel} from "./MemberTileViewModel.js";
import {createMemberComparator} from "./comparator.js";
import {MappedList} from "../../../observable/list/MappedList.js";

export class MemberListViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this.memberTileViewModels = this._mapTileViewModels(this._filterJoinedMembers(options.members)
                                                                .sortValues(createMemberComparator(options.powerLevels)));
    }

    _filterJoinedMembers(members) {
        return members.filterValues(member => member.membership === "join");
    }

    _mapTileViewModels(members) {
        const mapper = (member) => {
            return new MemberTileViewModel(this.childOptions({member}));
        }
        const updater = (vm, params, newMember) => vm.updateFrom(newMember);
        return new MappedList(members, mapper, updater);
    }
}
