import {ViewModel} from "../../ViewModel.js";

export class MemberTileViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._member = options.member;
    }

    get name() {
        return this._member.name;
    }

    get userId() {
        return this._member.userId;
    }
}
