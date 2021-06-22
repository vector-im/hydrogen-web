import {ViewModel} from "../../ViewModel.js";

export class MemberTileViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._member = this._options.member;
        this._shouldDisambiguate = options.shouldDisambiguate;
    }

    get name() {
        return this._member.name;
    }

    get userId() {
        return this._member.userId;
    }

    updateFrom(newMember) {
        this._member = newMember;
    }

}
