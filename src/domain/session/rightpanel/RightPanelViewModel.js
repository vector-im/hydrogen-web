import {ViewModel} from "../../ViewModel.js";
import {RoomDetailsViewModel} from "./RoomDetailsViewModel.js";

export class RightPanelViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._room = options.room;
        this._setupNavigation();
    }

    get roomDetailsViewModel() { return this._roomDetailsViewModel; }

    _setupNavigation() {
        const details = this.navigation.observe("details");
        this.track(details.subscribe(() => this._toggleRoomDetailsPanel()));
        this._toggleRoomDetailsPanel();
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
}
