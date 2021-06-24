/*
Copyright 2021 The Matrix.org Foundation C.I.C.

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

function getStyleSheetElements() {
    const styleSheets = Object.create(null);
    for (const link of document.getElementsByTagName("link")) {
        const match = link.href.match(/^.*\/themes\/(.*)\/.*\.css$/);
        if (match) {
            styleSheets[match[1]] = link;
        }
    }
    return styleSheets;
}

export class ThemeManager {
    constructor() {
        this._styleSheetElements = getStyleSheetElements();
    }

    get themes() {
        return Object.keys(this._styleSheetElements).map(key => { return {
            name: key,
            title: this._styleSheetElements[key].getAttribute("title") ?? key
        }});
    }

    get currentThemeName() {
        for (const name in this._styleSheetElements) {
            if (!this._styleSheetElements[name].disabled) {
                return name;
            }
        }
    }

    setTheme(name) {
        const styleSheetElements = this._styleSheetElements;

        if (!(name in styleSheetElements)) {
            return;
        }

        // Enable the selected stylesheet. Chrome only bothers to do an update on a true->false transition.
        styleSheetElements[name].disabled = false;

        return new Promise(resolve => {
            const switchTheme = function() {
                for (const other in styleSheetElements) {
                    styleSheetElements[other].disabled = other !== name;
                }
                resolve();
            };

            // Firefox preloads the CSS for disabled link elements while other browsers don't

            let cssLoaded = false;

            // If the CSS was *not* preloaded, the onload handler will trigger the theme switch once it has loaded
            styleSheetElements[name].onload = switchTheme;

            // Check if the CSS was preloaded or not
            for (const styleSheet of document.styleSheets) {
                if (styleSheet && styleSheet.href === styleSheetElements[name].href) {
                    cssLoaded = true;
                    break;
                }
            }

            // If the CSS was preloaded, unregister the onload handler and perform the theme switch directly
            if (cssLoaded) {
                styleSheetElements[name].onload = undefined;
                switchTheme();
            }
        });
    }
}
