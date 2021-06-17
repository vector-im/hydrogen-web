import {TemplateView} from "../../general/TemplateView.js";
import {RoomDetailsView} from "./RoomDetailsView.js";

export class RightPanelView extends TemplateView {
    render(t, vm) {
        return t.div({ className: "RightPanelView"}, 
            t.mapView(vm => vm.roomDetailsViewModel, roomDetailsViewModel => roomDetailsViewModel ? new RoomDetailsView(roomDetailsViewModel) : null)
        );
    }
}
