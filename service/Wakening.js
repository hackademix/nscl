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
if (!self.Wakening) {
  "use strict";

  // Thanks wOxxOm, https://groups.google.com/a/chromium.org/g/chromium-extensions/c/bnH_zx2LjQY/m/kOAzozYxCQAJ

  self.Wakening = {};

  const wakening = new Promise(resolve => {
    self.Wakening.done = resolve;
    Object.freeze(self.Wakening);
  });

  const apiRoot = browser;
  const handler = {
    apply(target, thisArg, [fn, ...filters]) {
      const waitingFn = async (...args) => {
        await wakening;
        console.debug("After wakening, calling", fn, args); // DEV_ONLY
        return fn(...args);
      };
      console.debug("Adding wakening-waiting listener", target, thisArg, fn, ...filters); // DEV_ONLY
      return Reflect.apply(target, thisArg, [waitingFn, ...filters]);
    }
  };

  const restoreMap = new Map();
  for (const apiName in apiRoot) {
    const api = apiRoot[apiName];
    if (typeof api !== "object") continue;
    const events = [];
    for (const key in api) {
      if (!/^on[A-Z]/.test(key) ||
        key == "onMessage" // patching onMessage causes trouble w/ promises!
      ) {
        continue;
      }
      console.debug("Wakening patching", apiName, key); // DEV_ONLY
      const event = api[key];
      if (!event) continue;
      const {addListener} = event;
      restoreMap.set(event, addListener);
      event.addListener = new Proxy(addListener, handler);
    }
  }

  (async () => {
    await wakening;
    console.debug("Wakening done"); // DEV_ONLY
    for (const [event, addListener] of [...restoreMap]) {
      event.addListener = addListener;
    }
    restoreMap.clear();
  })();
}