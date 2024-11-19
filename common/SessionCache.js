/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2024 Giorgio Maone <https://maone.net>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

var SessionCache = (() => {
  const NOP = () => {};
  return class SessionCache {
    #saving = false;

    constructor(storageKey, scope = {
        /* target: {}, afterLoad(data) {}, beforeSave() {} */
      }) {
      if (!(scope &&
        (typeof scope.target == "object" ||
          (typeof scope.afterLoad == "function"
            && typeof scope.beforeSave == "function")
        ))) {
        throw new TypeError("Illegal argument 2 (`scope` object): either a `target` object property or an `afterLoad`/`beforeSave` callback pair are required!")
      }
      this.storageKey = storageKey;
      this.scope = scope;

      // gracefully degrade if session storage is not supported (Gecko < 115)
      if (!browser.storage.session) {
        this.load =  this.save = NOP;
      }
    }

    async load() {
      let data = (await browser.storage.session.get(this.storageKey))[this.storageKey];
      if (!data) return;
      const {scope} = this;
      if (scope.afterLoad) {
        try {
          data = scope.afterLoad(data);
        } catch (e) {
          console.error(e, "Could not deserialize", this.storageKey, data);
          return;
        }
      }
      if (scope.target) {
        data = Object.assign(scope.target, data);
      }
      return data;
    }

    async save() {
      return this.#saving ||= new Promise(resolve => {
        queueMicrotask(async() => {
          this.#saving = false;
          const {scope} = this;
          let data;
          try {
            data = scope.beforeSave
              ? await scope.beforeSave(scope.target)
              : scope.target;
            resolve(await browser.storage.session.set({[this.storageKey]: data}));
          } catch (e) {
            console.error(e, "Could not serialize", data, this.storageKey);
            resolve();
          }
        })
      });
    }
  }
})();
