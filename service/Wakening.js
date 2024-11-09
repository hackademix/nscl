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

  // Thanks wOxxOm, https://groups.google.com/a/chromium.org/g/chromium-extensions/c/bnH_zx2LjQY/m/kOAzozYxCQAJ

  self.Wakening = {};

  const wakening = new Promise(resolve => {
    self.Wakening.done = resolve;
    Object.freeze(self.Wakening);
  });

  const {browser} = self;

  const apiHandler = {
    has: (src, key) => {
      const val = src[key];
      if (key === 'addListener' && typeof val === 'function') {
        return (fn, ...filters) => {
          src[key](async (...res) => (
          console.debug("Wakening on hold", src, new Error().stack), // DEV_ONLY
          await wakening,
          fn(...res)),
            ...filters);
        };
      }
      return val && typeof val === 'object' && /^[a-z]/.test(key)
        ? new Proxy(val, apiHandler)
        : val;
    },
  };

  self.browser = new Proxy(browser, apiHandler);

  (async () => {
    await wakening;
    console.debug("Wakening done"); // DEV_ONLY
    self.browser = browser;
  })();
}