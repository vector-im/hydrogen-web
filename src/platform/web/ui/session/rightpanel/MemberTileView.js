import {TemplateView} from "../../general/TemplateView.js";
import {AvatarView} from "../../avatar.js";

export class MemberTileView extends TemplateView {
    render(t, vm) {
        return t.div([t.view(new AvatarView(vm, 32)), vm => vm.name]);
    }
}
