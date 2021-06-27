import {TemplateView} from "../../general/TemplateView.js";
import {ListView} from "../../general/ListView.js";
import {MemberTileView} from "./MemberTileView.js";

export class MemberListView extends TemplateView {
    render(t, vm) {
        return t.view(new ListView({list: vm.memberTileViewModels, className:"MemberListView"}, tileViewModel => new MemberTileView(tileViewModel)));
    }
}
