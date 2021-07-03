/*
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

import {createFetchRequest} from "./dom/request/fetch.js";
import {xhrRequest} from "./dom/request/xhr.js";
import {StorageFactory} from "../../matrix/storage/idb/StorageFactory.js";
import {SessionInfoStorage} from "../../matrix/sessioninfo/localstorage/SessionInfoStorage.js";
import {SettingsStorage} from "./dom/SettingsStorage.js";
import {Encoding} from "./utils/Encoding.js";
import {OlmWorker} from "../../matrix/e2ee/OlmWorker.js";
import {IDBLogger} from "../../logging/IDBLogger.js";
import {ConsoleLogger} from "../../logging/ConsoleLogger.js";
import {RootView} from "./ui/RootView.js";
import {Clock} from "./dom/Clock.js";
import {ServiceWorkerHandler} from "./dom/ServiceWorkerHandler.js";
import {NotificationService} from "./dom/NotificationService.js";
import {History} from "./dom/History.js";
import {OnlineStatus} from "./dom/OnlineStatus.js";
import {Crypto} from "./dom/Crypto.js";
import {estimateStorageUsage} from "./dom/StorageEstimate.js";
import {WorkerPool} from "./dom/WorkerPool.js";
import {BlobHandle} from "./dom/BlobHandle.js";
import {hasReadPixelPermission, ImageHandle, VideoHandle} from "./dom/ImageHandle.js";
import {downloadInIframe} from "./dom/download.js";
import {Disposables} from "../../utils/Disposables.js";
import {HTMLParseResult} from "./HTMLParseResult.js";

function addScript(src) {
    return new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.setAttribute("src", src );
        s.onload=resolve;
        s.onerror=reject;
        document.body.appendChild(s);
    });
}

async function loadOlm(olmPaths) {
    // make crypto.getRandomValues available without
    // a prefix on IE11, needed by olm to work
    if (window.msCrypto && !window.crypto) {
        window.crypto = window.msCrypto;
    }
    if (olmPaths) {
        if (window.WebAssembly) {
            await addScript(olmPaths.wasmBundle);
            await window.Olm.init({locateFile: () => olmPaths.wasm});
        } else {
            await addScript(olmPaths.legacyBundle);
            await window.Olm.init();
        }
        return window.Olm;
    }
    return null;
}

// make path relative to basePath,
// assuming it and basePath are relative to document
function relPath(path, basePath) {
    const idx = basePath.lastIndexOf("/");
    const dir = idx === -1 ? "" : basePath.slice(0, idx);
    const dirCount = dir.length ? dir.split("/").length : 0;
    return "../".repeat(dirCount) + path;
}

async function loadOlmWorker(config) {
    const workerPool = new WorkerPool(config.worker, 4);
    await workerPool.init();
    const path = relPath(config.olm.legacyBundle, config.worker);
    await workerPool.sendAll({type: "load_olm", path});
    const olmWorker = new OlmWorker(workerPool);
    return olmWorker;
}

// needed for mobile Safari which shifts the layout viewport up without resizing it
// when the keyboard shows (see https://bugs.webkit.org/show_bug.cgi?id=141832)
function adaptUIOnVisualViewportResize(container) {
    if (!window.visualViewport) {
        return;
    }
    const handler = () => {
        const sessionView = container.querySelector('.SessionView');
        if (!sessionView) {
            return;
        }

        const scrollable = container.querySelector('.bottom-aligned-scroll');
        let scrollTopBefore, heightBefore, heightAfter;

        if (scrollable) {
            scrollTopBefore = scrollable.scrollTop;
            heightBefore = scrollable.offsetHeight;
        }

        // Ideally we'd use window.visualViewport.offsetTop but that seems to occasionally lag
        // behind (last tested on iOS 14.4 simulator) so we have to compute the offset manually
        const offsetTop = sessionView.offsetTop + sessionView.offsetHeight - window.visualViewport.height;

        container.style.setProperty('--ios-viewport-height', window.visualViewport.height.toString() + 'px');
        container.style.setProperty('--ios-viewport-top', offsetTop.toString() + 'px');

        if (scrollable) {
            heightAfter = scrollable.offsetHeight;
            scrollable.scrollTop = scrollTopBefore + heightBefore - heightAfter;
        }
    };
    window.visualViewport.addEventListener('resize', handler);
    return () => {
        window.visualViewport.removeEventListener('resize', handler);
    };
}

export class Platform {
    constructor(container, config, cryptoExtras = null, options = null) {
        this._config = config;
        this._container = container;
        this.settingsStorage = new SettingsStorage("hydrogen_setting_v1_");
        this.clock = new Clock();
        this.encoding = new Encoding();
        this.random = Math.random;
        if (options?.development) {
            this.logger = new ConsoleLogger({platform: this});
        } else {
            this.logger = new IDBLogger({name: "hydrogen_logs", platform: this});
        }
        this.history = new History();
        this.onlineStatus = new OnlineStatus();
        this._serviceWorkerHandler = null;
        if (config.serviceWorker && "serviceWorker" in navigator) {
            this._serviceWorkerHandler = new ServiceWorkerHandler();
            this._serviceWorkerHandler.registerAndStart(config.serviceWorker);
        }
        this.notificationService = new NotificationService(this._serviceWorkerHandler, config.push);
        this.crypto = new Crypto(cryptoExtras);
        this.storageFactory = new StorageFactory(this._serviceWorkerHandler);
        this.sessionInfoStorage = new SessionInfoStorage("hydrogen_sessions_v1");
        this.estimateStorageUsage = estimateStorageUsage;
        if (typeof fetch === "function") {
            this.request = createFetchRequest(this.clock.createTimeout, this._serviceWorkerHandler);
        } else {
            this.request = xhrRequest;
        }
        const isIE11 = !!window.MSInputMethodContext && !!document.documentMode;
        this.isIE11 = isIE11;
        // From https://stackoverflow.com/questions/9038625/detect-if-device-is-ios/9039885
        const isIOS = /iPad|iPhone|iPod/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) && !window.MSStream;
        this.isIOS = isIOS;
        this._disposables = new Disposables();
    }

    get updateService() {
        return this._serviceWorkerHandler;
    }

    loadOlm() {
        return loadOlm(this._config.olm);
    }

    get config() {
        return this._config;
    }

    async loadOlmWorker() {
        if (!window.WebAssembly) {
            return await loadOlmWorker(this._config);
        }
    }

    createAndMountRootView(vm) {
        if (this.isIE11) {
            this._container.className += " legacy";
        }
        if (this.isIOS) {
            this._container.className += " ios";
            const disposable = adaptUIOnVisualViewportResize(this._container);
            if (disposable) {
                this._disposables.track(disposable);
            }
        }
        window.__hydrogenViewModel = vm;
        const view = new RootView(vm);
        this._container.appendChild(view.mount());
    }

    setNavigation(navigation) {
        this._serviceWorkerHandler?.setNavigation(navigation);
    }

    createBlob(buffer, mimetype) {
        return BlobHandle.fromBuffer(buffer, mimetype);
    }

    saveFileAs(blobHandle, filename) {
        if (navigator.msSaveBlob) {
            navigator.msSaveBlob(blobHandle.nativeBlob, filename);
        } else {
            downloadInIframe(this._container, this._config.downloadSandbox, blobHandle, filename, this.isIOS);
        }
    }

    openFile(mimeType = null) {
        const input = document.createElement("input");
        input.setAttribute("type", "file");
        input.className = "hidden";
        if (mimeType) {
            input.setAttribute("accept", mimeType);
        }
        const promise = new Promise((resolve, reject) => {
            const checkFile = () => {
                input.removeEventListener("change", checkFile, true);
                const file = input.files[0];
                this._container.removeChild(input);
                if (file) {
                    resolve({name: file.name, blob: BlobHandle.fromBlob(file)});
                } else {
                    resolve();
                }
            }
            input.addEventListener("change", checkFile, true);
        });
        // IE11 needs the input to be attached to the document
        this._container.appendChild(input);
        input.click();
        return promise;
    }

    parseHTML(html) {
        const bodyNode = new DOMParser().parseFromString(html, "text/html").body;
        return new HTMLParseResult(bodyNode);
    }

    async loadImage(blob) {
        return ImageHandle.fromBlob(blob);
    }

    async loadVideo(blob) {
        return VideoHandle.fromBlob(blob);
    }

    hasReadPixelPermission() {
        return hasReadPixelPermission();
    }

    get devicePixelRatio() {
        return window.devicePixelRatio || 1;
    }

    get version() {
        return window.HYDROGEN_VERSION;
    }

    dispose() {
        this._disposables.dispose();
    }
}
