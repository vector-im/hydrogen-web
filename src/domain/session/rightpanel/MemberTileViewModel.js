import {ViewModel} from "../../ViewModel.js";

export class MemberTileViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._member = options.member;
    }

    get displayName() {
        return this._member.displayName;
    }

    get userId() {
        return this._member.userId;
    }
}
