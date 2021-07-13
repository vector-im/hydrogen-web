import {TemplateView} from "../../general/TemplateView.js";
import {LazyListView} from "../../general/LazyListView.js";
import {MemberTileView} from "./MemberTileView.js";

export class MemberListView extends TemplateView {
    render(t, vm) {
        return t.view(new LazyListView({
            list: vm.memberTileViewModels,
            className: "MemberListView",
            itemHeight: 40
        }, tileViewModel => new MemberTileView(tileViewModel)));
    }
}
