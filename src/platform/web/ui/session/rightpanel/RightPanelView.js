import {TemplateView} from "../../general/TemplateView.js";
import {RoomDetailsView} from "./RoomDetailsView.js";
import {MemberListView} from "./MemberListView.js";
import {LoadingView} from "./LoadingView.js";

export class RightPanelView extends TemplateView {
    render(t) {
        const viewFromType = {
            "room-details": RoomDetailsView,
            "member-list": MemberListView
        };
        return t.div({ className: "RightPanelView" },
            [
                t.mapView(vm => vm.activeViewModel, vm => vm ? new viewFromType[vm.type](vm) : new LoadingView())
            ]
        );
    }
}
