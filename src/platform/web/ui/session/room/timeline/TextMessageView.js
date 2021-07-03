/*
Copyright 2020 Bruno Windels <bruno@windels.cloud>

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

import {StaticView} from "../../../general/StaticView.js";
import {tag, text} from "../../../general/html.js";
import {BaseMessageView} from "./BaseMessageView.js";

export class TextMessageView extends BaseMessageView {
    renderMessageBody(t, vm) {
        return t.p({
            className: {
                "Timeline_messageBody": true,
                statusMessage: vm => vm.shape === "message-status",
            },
        }, [
            t.mapView(vm => vm.body, body => new BodyView(body)),
            t.time({className: {hidden: !vm.date}}, vm.date + " " + vm.time)
        ]);
    }
}

/**
 * Map from part to function that outputs DOM for the part
 */
const formatFunction = {
    header: headerBlock => tag["h" + Math.min(6,headerBlock.level)]({}, renderParts(headerBlock.inlines)),
    codeblock: codeBlock => tag.pre({}, tag.code({}, text(codeBlock.text))),
    emph: emphPart => tag.em({}, renderParts(emphPart.inlines)),
    code: codePart => tag.code({}, text(codePart.text)),
    text: textPart => text(textPart.text),
    link: linkPart => tag.a({ href: linkPart.url, target: "_blank", rel: "noopener" }, renderParts(linkPart.inlines)),
    newline: () => tag.br()
};

function renderPart(part) {
    const f = formatFunction[part.type];
    return f(part);
}

function renderParts(parts) {
    return Array.from(parts, renderPart);
}

class BodyView extends StaticView {
    render(t, messageBody) {
        const container = t.span();
        for (const part of messageBody.parts) {
            container.appendChild(renderPart(part));
        }
        return container;
    }
}
