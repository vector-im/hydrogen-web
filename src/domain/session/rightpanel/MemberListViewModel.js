import {ViewModel} from "../../ViewModel.js";
import {MemberTileViewModel} from "./MemberTileViewModel.js";
import {createMemberComparator} from "./comparator.js";
import {Disambiguator} from "./disambiguator.js";

export class MemberListViewModel extends ViewModel {
    constructor(options) {
        super(options);
        const powerLevels = options.powerLevelsObservable.get();
        // We should subscribe to the observable here so that we can resort when pl changes
        this.memberTileViewModels = this._mapTileViewModels(this._filterJoinedMembers(options.members))
                                        .sortValues(createMemberComparator(powerLevels));
        this.nameDisambiguator = new Disambiguator();
        this.mediaRepository = options.mediaRepository;
    }

    get type() { return "member-list"; }

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
