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

export class SettingsStorage {
    constructor(prefix) {
        this._prefix = prefix;
    }

    async setString(key, value) {
        this._set(key, value);
    }

    async getString(key, defaultValue = "") {
        const value = window.localStorage.getItem(`${this._prefix}${key}`);
        if (typeof value === "string") {
            return value;
        }
        return defaultValue;
    }

    async setInt(key, value) {
        this._set(key, value);
    }

    async getInt(key, defaultValue = 0) {
        const value = window.localStorage.getItem(`${this._prefix}${key}`);
        if (typeof value === "string") {
            return parseInt(value, 10);
        }
        return defaultValue;
    }

    async setBool(key, value) {
        this._set(key, value);
    }

    async getBool(key, defaultValue = false) {
        const value = window.localStorage.getItem(`${this._prefix}${key}`);
        if (typeof value === "string") {
            return value === "true";
        }
        return defaultValue;
    }

    async remove(key) {
        window.localStorage.removeItem(`${this._prefix}${key}`);
    }

    async _set(key, value) {
        window.localStorage.setItem(`${this._prefix}${key}`, value);
    }
}
