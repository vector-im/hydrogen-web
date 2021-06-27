import {ViewModel} from "../../ViewModel.js";
import {avatarInitials, getIdentifierColorNumber, getAvatarHttpUrl} from "../../avatar.js";

export class RoomDetailsViewModel extends ViewModel {
    constructor(options) {
        super(options);
        this._room = options.room;
        this._onRoomChange = this._onRoomChange.bind(this);
        this._room.on("change", this._onRoomChange);
    }

    get type() {
        return "room-details";
    }

    get roomId() {
        return this._room.id;
    }

    get canonicalAlias() {
        return this._room.canonicalAlias;
    }

    get name() {
        return this._room.name;
    }

    get isEncrypted() {
        return !!this._room.isEncrypted;
    }

    get memberCount() {
        return this._room.joinedMemberCount;
    }

    get avatarLetter() {
        return avatarInitials(this.name);
    }

    get avatarColorNumber() {
        return getIdentifierColorNumber(this.roomId)
    }

    avatarUrl(size) {
        return getAvatarHttpUrl(this._room.avatarUrl, size, this.platform, this._room.mediaRepository);
    }

    get avatarTitle() {
        return this.name;
    }

    _onRoomChange() {
        this.emitChange();
    }

    closePanel() {
        const path = this.navigation.path.until("room");
        this.navigation.applyPath(path);
    }

    dispose() {
        super.dispose();
        this._room.off("change", this._onRoomChange);
    }
}
