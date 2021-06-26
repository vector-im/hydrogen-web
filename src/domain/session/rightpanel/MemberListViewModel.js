import {ViewModel} from "../../ViewModel.js";
import {MemberTileViewModel} from "./MemberTileViewModel.js";
import {createMemberComparator} from "./comparator.js";
import {Disambiguator} from "./disambiguator.js";

export class MemberListViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this.memberTileViewModels = this._mapTileViewModels(this._filterJoinedMembers(options.members))
                                        .sortValues(createMemberComparator(options.powerLevels));
        this.nameDisambiguator = new Disambiguator();
        this.mediaRepository = options.mediaRepository;
    }

    _filterJoinedMembers(members) {
        return members.filterValues(member => member.membership === "join");
    }

    _mapTileViewModels(members) {
        const mapper = (member, emitChange) => {
            const mediaRepository = this.mediaRepository;
            const vm = new MemberTileViewModel(this.childOptions({member, emitChange, mediaRepository}));
            this.nameDisambiguator.disambiguate(vm);
            return vm;
        }
        const updater = (vm, params, newMember) => {
            vm.updateFrom(newMember);
            this.nameDisambiguator.disambiguate(vm);
        };
        return members.mapValues(mapper, updater);
    }

}
