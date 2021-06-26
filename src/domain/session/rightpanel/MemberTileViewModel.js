import {ViewModel} from "../../ViewModel.js";
import {avatarInitials, getIdentifierColorNumber, getAvatarHttpUrl} from "../../avatar.js";

export class MemberTileViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._member = this._options.member;
        this._mediaRepository = options.mediaRepository
        this._previousName = null;
        this._nameChanged = true;
    }

    get name() {
        return `${this._member.name}${this._disambiguationPart}`;
    }

    get _disambiguationPart() {
        return this._disambiguate ? ` (${this.userId})` : "";
    }

    get userId() {
        return this._member.userId;
    }

    get previousName() {
        return this._previousName;
    }

    get nameChanged() {
        return this._nameChanged;
    }

    _updatePreviousName(newName) {
        const currentName = this._member.name;
        if (currentName !== newName) {
            this._previousName = currentName;
            this._nameChanged = true;
        } else {
            this._nameChanged = false;
        }
    }

    setDisambiguation(status) {
        this._disambiguate = status;
        this.emitChange();
    }

    updateFrom(newMember) {
        this._updatePreviousName(newMember.name);
        this._member = newMember;
    }

    get avatarLetter() {
        return avatarInitials(this.name);
    }

    get avatarColorNumber() {
        return getIdentifierColorNumber(this.userId)
    }

    avatarUrl(size) {
        return getAvatarHttpUrl(this._member.avatarUrl, size, this.platform, this._mediaRepository);
    }

    get avatarTitle() {
        return this.name;
    }
}
