/*
Copyright 2020 Bruno Windels <bruno@windels.cloud>
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import {LeftPanelView} from "./leftpanel/LeftPanelView.js";
import {RoomView} from "./room/RoomView.js";
import {UnknownRoomView} from "./room/UnknownRoomView.js";
import {InviteView} from "./room/InviteView.js";
import {LightboxView} from "./room/LightboxView.js";
import {TemplateView} from "../general/TemplateView.js";
import {StaticView} from "../general/StaticView.js";
import {SessionStatusView} from "./SessionStatusView.js";
import {RoomGridView} from "./RoomGridView.js";
import {SettingsView} from "./settings/SettingsView.js";
import {RoomDetailsView} from "./rightpanel/RoomDetailsView.js";
import {MemberListView} from "./rightpanel/MemberListView.js";

export class SessionView extends TemplateView {
    render(t, vm) {
        return t.div({
            className: {
                "SessionView": true,
                "middle-shown": vm => !!vm.activeMiddleViewModel,
                "right-shown": vm => !!vm.roomDetailsViewModel
            },
        }, [
            t.view(new SessionStatusView(vm.sessionStatusViewModel)),
            t.view(new LeftPanelView(vm.leftPanelViewModel)),
            t.mapView(vm => vm.activeMiddleViewModel, () => {
                if (vm.roomGridViewModel) {
                    return new RoomGridView(vm.roomGridViewModel);
                } else if (vm.settingsViewModel) {
                    return new SettingsView(vm.settingsViewModel);
                } else if (vm.currentRoomViewModel) {
                    if (vm.currentRoomViewModel.kind === "invite") {
                        return new InviteView(vm.currentRoomViewModel);
                    } else if (vm.currentRoomViewModel.kind === "room") {
                        return new RoomView(vm.currentRoomViewModel);
                    } else {
                        return new UnknownRoomView(vm.currentRoomViewModel);
                    }
                } else {
                    return new StaticView(t => t.div({className: "room-placeholder"}, t.h2(vm.i18n`Choose a room on the left side.`)));
                }
            }),
            t.mapView(vm => vm.roomDetailsViewModel, roomDetailsViewModel => roomDetailsViewModel ? new RoomDetailsView(roomDetailsViewModel) : null),
            t.mapView(vm => vm.memberListViewModel, memberListViewModel => memberListViewModel ? new MemberListView(memberListViewModel) : null),
            t.mapView(vm => vm.lightboxViewModel, lightboxViewModel => lightboxViewModel ? new LightboxView(lightboxViewModel) : null)
        ]);
    }
}
