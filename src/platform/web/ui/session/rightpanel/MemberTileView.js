import {TemplateView} from "../../general/TemplateView.js";

export class MemberTileView extends TemplateView {
    render(t, vm) {
        return t.div(vm.displayName);
    }
}
