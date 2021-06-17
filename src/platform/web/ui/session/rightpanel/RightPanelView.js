import {TemplateView} from "../../general/TemplateView.js";
import {RoomDetailsView} from "./RoomDetailsView.js";
import {MemberListView} from "./MemberListView.js";

export class RightPanelView extends TemplateView {
    render(t) {
        return t.div({className: "RightPanelView"}, 
            [
                t.mapView(vm => vm.roomDetailsViewModel, roomDetailsViewModel => roomDetailsViewModel ? new RoomDetailsView(roomDetailsViewModel) : null),
                t.mapView(vm => vm.memberListViewModel, memberListViewModel => memberListViewModel ? new MemberListView(memberListViewModel) : null)
            ]
        );
    }
}
