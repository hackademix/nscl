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

// depends on /nscl/common/SessionCache.js

var Wakening = {
  async waitFor(...sleepers) {
    // Thanks wOxxOm, https://groups.google.com/a/chromium.org/g/chromium-extensions/c/bnH_zx2LjQY/m/kOAzozYxCQAJ
    const wakening = await (async () => {
      const {browser} = self;
      const apiHandler = {
        has: (src, key) => {
          const val = src[key];
          if (key === 'addListener' && typeof val === 'function') {
            return (fn, ...filters) => {
              src[key](async (...res) => (await wakening, fn(...res)), ...filters);
            };
          }
          return val && typeof val === 'object' && /^[a-z]/.test(key)
            ? new Proxy(val, chromeHandler)
            : val;
        },
      };
      self.browser = new Proxy(browser, apiHandler);
      for (let s of sleepers) {
        await (s.wakening || s);
      }
      self.browser = browser;
    })();
    return wakening;
  }
};