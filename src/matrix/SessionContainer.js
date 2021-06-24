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

import {createEnum} from "../utils/enum.js";
import {ObservableValue} from "../observable/ObservableValue.js";
import {HomeServerApi} from "./net/HomeServerApi.js";
import {Reconnector, ConnectionStatus} from "./net/Reconnector.js";
import {ExponentialRetryDelay} from "./net/ExponentialRetryDelay.js";
import {MediaRepository} from "./net/MediaRepository.js";
import {RequestScheduler} from "./net/RequestScheduler.js";
import {Sync, SyncStatus} from "./Sync.js";
import {Session} from "./Session.js";

export const LoadStatus = createEnum(
    "NotLoading",
    "Login",
    "LoginFailed",
    "Loading",
    "SessionSetup", // upload e2ee keys, ...
    "Migrating",    //not used atm, but would fit here
    "FirstSync",
    "Error",
    "Ready",
);

export const LoginFailure = createEnum(
    "Connection",
    "Credentials",
    "Unknown",
);

function normalizeHomeserver(homeServer) {
    try {
        return new URL(homeServer).origin;
    } catch (err) {
        return new URL(`https://${homeServer}`).origin;
    }
}

export class SessionContainer {
    constructor({platform, olmPromise, workerPromise}) {
        this._platform = platform;
        this._sessionStartedByReconnector = false;
        this._status = new ObservableValue(LoadStatus.NotLoading);
        this._error = null;
        this._loginFailure = null;
        this._reconnector = null;
        this._session = null;
        this._sync = null;
        this._sessionId = null;
        this._storage = null;
        this._requestScheduler = null;
        this._olmPromise = olmPromise;
        this._workerPromise = workerPromise;
    }

    createNewSessionId() {
        return (Math.floor(this._platform.random() * Number.MAX_SAFE_INTEGER)).toString();
    }

    get sessionId() {
        return this._sessionId;
    }

    async startWithExistingSession(sessionId) {
        if (this._status.get() !== LoadStatus.NotLoading) {
            return;
        }
        this._status.set(LoadStatus.Loading);
        await this._platform.logger.run("load session", async log => {
            log.set("id", sessionId);
            try {
                const sessionInfo = await this._platform.sessionInfoStorage.get(sessionId);
                if (!sessionInfo) {
                    throw new Error("Invalid session id: " + sessionId);
                }
                await this._loadSessionInfo(sessionInfo, false, log);
                log.set("status", this._status.get());
            } catch (err) {
                log.catch(err);
                this._error = err;
                this._status.set(LoadStatus.Error);
            }
        });
    }

    async startWithLogin(homeServer, username, password, guest = false) {
        if (this._status.get() !== LoadStatus.NotLoading) {
            return;
        }
        await this._platform.logger.run("login", async log => {
            this._status.set(LoadStatus.Login);
            homeServer = normalizeHomeserver(homeServer);
            const clock = this._platform.clock;
            let sessionInfo;
            try {
                const request = this._platform.request;
                const hsApi = new HomeServerApi({homeServer, request});
                let loginData;
                if (guest === true) {
                    loginData = await hsApi.guestLogin("Hydrogen", {log}).response();
                } else {
                    loginData = await hsApi.passwordLogin(username, password, "Hydrogen", {log}).response();
                }
                const sessionId = this.createNewSessionId();
                sessionInfo = {
                    id: sessionId,
                    deviceId: loginData.device_id,
                    userId: loginData.user_id,
                    homeServer: homeServer,
                    accessToken: loginData.access_token,
                    lastUsed: clock.now()
                };
                log.set("id", sessionId);
                await this._platform.sessionInfoStorage.add(sessionInfo);            
            } catch (err) {
                this._error = err;
                if (err.name === "HomeServerError") {
                    if (err.errcode === "M_FORBIDDEN") {
                        this._loginFailure = LoginFailure.Credentials;
                    } else {
                        this._loginFailure = LoginFailure.Unknown;
                    }
                    log.set("loginFailure", this._loginFailure);
                    this._status.set(LoadStatus.LoginFailed);
                } else if (err.name === "ConnectionError") {
                    this._loginFailure = LoginFailure.Connection;
                    this._status.set(LoadStatus.LoginFailed);
                } else {
                    this._status.set(LoadStatus.Error);
                }
                return;
            }
            // loading the session can only lead to
            // LoadStatus.Error in case of an error,
            // so separate try/catch
            try {
                await this._loadSessionInfo(sessionInfo, true, log);
                log.set("status", this._status.get());
            } catch (err) {
                log.catch(err);
                this._error = err;
                this._status.set(LoadStatus.Error);
            }
        });
    }

    async _loadSessionInfo(sessionInfo, isNewLogin, log) {
        log.set("appVersion", this._platform.version);
        const clock = this._platform.clock;
        this._sessionStartedByReconnector = false;
        this._status.set(LoadStatus.Loading);
        this._reconnector = new Reconnector({
            onlineStatus: this._platform.onlineStatus,
            retryDelay: new ExponentialRetryDelay(clock.createTimeout),
            createMeasure: clock.createMeasure
        });
        const hsApi = new HomeServerApi({
            homeServer: sessionInfo.homeServer,
            accessToken: sessionInfo.accessToken,
            request: this._platform.request,
            reconnector: this._reconnector,
        });
        this._sessionId = sessionInfo.id;
        this._storage = await this._platform.storageFactory.create(sessionInfo.id);
        // no need to pass access token to session
        const filteredSessionInfo = {
            id: sessionInfo.id,
            deviceId: sessionInfo.deviceId,
            userId: sessionInfo.userId,
            homeServer: sessionInfo.homeServer,
        };
        const olm = await this._olmPromise;
        let olmWorker = null;
        if (this._workerPromise) {
            olmWorker = await this._workerPromise;
        }
        this._requestScheduler = new RequestScheduler({hsApi, clock});
        this._requestScheduler.start();
        const mediaRepository = new MediaRepository({
            homeServer: sessionInfo.homeServer,
            platform: this._platform,
        });
        this._session = new Session({
            storage: this._storage,
            sessionInfo: filteredSessionInfo,
            hsApi: this._requestScheduler.hsApi,
            olm,
            olmWorker,
            mediaRepository,
            platform: this._platform,
        });
        await this._session.load(log);
        if (isNewLogin) {
            this._status.set(LoadStatus.SessionSetup);
            await log.wrap("createIdentity", log => this._session.createIdentity(log));
        }
        
        this._sync = new Sync({hsApi: this._requestScheduler.hsApi, storage: this._storage, session: this._session, logger: this._platform.logger});
        // notify sync and session when back online
        this._reconnectSubscription = this._reconnector.connectionStatus.subscribe(state => {
            if (state === ConnectionStatus.Online) {
                this._platform.logger.runDetached("reconnect", async log => {
                    // needs to happen before sync and session or it would abort all requests
                    this._requestScheduler.start();
                    this._sync.start();
                    this._sessionStartedByReconnector = true;
                    await log.wrap("session start", log => this._session.start(this._reconnector.lastVersionsResponse, log));
                });
            }
        });
        await log.wrap("wait first sync", () => this._waitForFirstSync());

        this._status.set(LoadStatus.Ready);

        // if the sync failed, and then the reconnector
        // restored the connection, it would have already
        // started to session, so check first
        // to prevent an extra /versions request
        if (!this._sessionStartedByReconnector) {
            const lastVersionsResponse = await hsApi.versions({timeout: 10000, log}).response();
            // log as ref as we don't want to await it
            await log.wrap("session start", log => this._session.start(lastVersionsResponse, log));
        }
    }

    async _waitForFirstSync() {
        this._sync.start();
        this._status.set(LoadStatus.FirstSync);
        // only transition into Ready once the first sync has succeeded
        this._waitForFirstSyncHandle = this._sync.status.waitFor(s => {
            if (s === SyncStatus.Stopped) {
                // keep waiting if there is a ConnectionError
                // as the reconnector above will call 
                // sync.start again to retry in this case
                return this._sync.error?.name !== "ConnectionError";
            }
            return s === SyncStatus.Syncing;
        });
        try {
            await this._waitForFirstSyncHandle.promise;
            if (this._sync.status.get() === SyncStatus.Stopped && this._sync.error) {
                throw this._sync.error;
            }
        } catch (err) {
            // if dispose is called from stop, bail out
            if (err.name === "AbortError") {
                return;
            }
            throw err;
        } finally {
            this._waitForFirstSyncHandle = null;
        }
    }


    get loadStatus() {
        return this._status;
    }

    get loadError() {
        return this._error;
    }

    /** only set at loadStatus InitialSync, CatchupSync or Ready */
    get sync() {
        return this._sync;
    }

    /** only set at loadStatus InitialSync, CatchupSync or Ready */
    get session() {
        return this._session;
    }

    get reconnector() {
        return this._reconnector;
    }

    dispose() {
        if (this._reconnectSubscription) {
            this._reconnectSubscription();
            this._reconnectSubscription = null;
        }
        if (this._requestScheduler) {
            this._requestScheduler.stop();
        }
        if (this._sync) {
            this._sync.stop();
        }
        if (this._session) {
            this._session.dispose();
        }
        if (this._waitForFirstSyncHandle) {
            this._waitForFirstSyncHandle.dispose();
            this._waitForFirstSyncHandle = null;
        }
        if (this._storage) {
            this._storage.close();
            this._storage = null;
        }
    }

    async deleteSession() {
        if (this._sessionId) {
            // if one fails, don't block the other from trying
            // also, run in parallel
            await Promise.all([
                this._platform.storageFactory.delete(this._sessionId),
                this._platform.sessionInfoStorage.delete(this._sessionId),
            ]);
            this._sessionId = null;
        }
    }
}
