import {TemplateView} from "../../general/TemplateView.js";
import {ListView} from "../../general/ListView.js";
import {MemberTileView} from "./MemberTileView.js";
import {spinner} from "../../common.js";

export class MemberListView extends TemplateView {
    render(t, vm) {
        return t.view(new ListView({list: vm.memberTileViewModels, className:"MemberListView"}, tileViewModel => new MemberTileView(tileViewModel)));
    }
}

export class MemberListLoadingView extends TemplateView {
    render(t) {
        return t.div(["Loading ", spinner(t)]);
    }
}
