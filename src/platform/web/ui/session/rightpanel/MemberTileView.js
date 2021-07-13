import {TemplateView} from "../../general/TemplateView.js";
import {AvatarView} from "../../avatar.js";

export class MemberTileView extends TemplateView {
    render(t, vm) {
        return t.li({ className: "MemberTileView" }, [
            t.view(new AvatarView(vm, 32)),
            t.div({ className: "MemberTileView_name" }, (vm) => vm.name),
        ]);
    }
}
