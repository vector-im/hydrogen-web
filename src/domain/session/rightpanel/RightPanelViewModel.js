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

    async _getMemberArguments() {
        const list = await this._room.loadMemberList();
        const room = this._room;
        const powerLevelsObservable = await this._room.observePowerLevels();
        return {members: list.members, powerLevelsObservable, mediaRepository: room.mediaRepository};
    }

    _setupNavigation() {
        this._hookUpdaterToSegment("details", RoomDetailsViewModel, () => { return {room: this._room}; });
        this._hookUpdaterToSegment("members", MemberListViewModel, () => this._getMemberArguments());
    }

    _hookUpdaterToSegment(segment, viewmodel, argCreator) {
        const observable = this.navigation.observe(segment);
        const updater = this._setupUpdater(segment, viewmodel, argCreator);
        this.track(observable.subscribe(() => updater()));
    }

    _setupUpdater(segment, viewmodel, argCreator) {
        const updater = async (skipDispose = false) => {
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
        updater(true);
        return updater;
    }
}
