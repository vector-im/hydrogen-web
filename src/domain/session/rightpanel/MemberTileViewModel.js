import {ViewModel} from "../../ViewModel.js";

export class MemberTileViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this.member = options.member;
    }

    get displayName() {
        return this.member.displayName;
    }
}
