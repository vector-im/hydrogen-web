import {ViewModel} from "../../ViewModel.js";
import {RoomDetailsViewModel} from "./RoomDetailsViewModel.js";
import {MemberListViewModel} from "./MemberListViewModel.js";

export class RightPanelViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._room = options.room;
        this._setupNavigation();
    }

    get roomDetailsViewModel() { return this._roomDetailsViewModel; }
    get memberListViewModel() { return this._memberListViewModel; }

    _setupNavigation() {
        const details = this.navigation.observe("details");
        this.track(details.subscribe(() => this._toggleRoomDetailsPanel()));
        this._toggleRoomDetailsPanel();

        const members = this.navigation.observe("members");
        this.track(members.subscribe(() => this._toggleMemberListPanel()));
        this._toggleMemberListPanel();
    }

    _toggleRoomDetailsPanel() {
        this._roomDetailsViewModel = this.disposeTracked(this._roomDetailsViewModel);
        const enable = !!this.navigation.path.get("details")?.value;
        if (enable) {
            const room = this._room;
            this._roomDetailsViewModel = this.track(new RoomDetailsViewModel(this.childOptions({room})));
        }
        this.emitChange("roomDetailsViewModel");
    }

    async _toggleMemberListPanel() {
        this._memberListViewModel = this.disposeTracked(this._memberListViewModel);
        const enable = !!this.navigation.path.get("members")?.value;
        if (enable) {
            const list = await this._room.loadMemberList();
            const members = list.members;
            this._memberListViewModel = this.track(
                new MemberListViewModel(this.childOptions({members}))
            );
        }
        this.emitChange("memberListViewModel");
    }
}
