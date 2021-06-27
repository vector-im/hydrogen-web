import {TemplateView} from "../../general/TemplateView.js";
import {spinner} from "../../common.js";

export class LoadingView extends TemplateView {
    render(t) {
        return t.div(["Loading ", spinner(t)]);
    }
}
