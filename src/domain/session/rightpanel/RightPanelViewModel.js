import {ViewModel} from "../../ViewModel.js";
import {RoomDetailsViewModel} from "./RoomDetailsViewModel.js";
import {MemberListViewModel} from "./MemberListViewModel.js";

export class RightPanelViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._room = options.room;
        this._setupNavigation();
    }

    get activeViewModel() { return this._activeViewModel; }

    async _memberArguments() {
        const list = await this._room.loadMemberList();
        const room = this._room;
        return {members: list.members, powerLevels: room.powerLevels, mediaRepository: room.mediaRepository};
    }

    _setupNavigation() {
        this._hookSegmentToToggler("details", RoomDetailsViewModel, () => { return {room: this._room}; });
        this._hookSegmentToToggler("members", MemberListViewModel, () => this._memberArguments());
    }

    _hookSegmentToToggler(segment, viewmodel, argCreator) {
        const observable = this.navigation.observe(segment);
        const toggler = this._setupToggler(segment, viewmodel, argCreator);
        this.track(observable.subscribe(() => toggler()));
    }

    _setupToggler(segment, viewmodel, argCreator) {
        const toggler = async (skipDispose = false) => {
            if (!skipDispose) {
                this._activeViewModel = this.disposeTracked(this._activeViewModel);
            }
            const enable = !!this.navigation.path.get(segment)?.value;
            if (enable) {
                const args = await argCreator();
                this._activeViewModel = this.track(new viewmodel(this.childOptions(args)));
            }
            this.emitChange("activeViewModel");
        };
        toggler(true);
        return toggler;
    }
}
