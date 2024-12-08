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

{
  let mozWebExtUrl = typeof document === "object" && document.URL.startsWith("moz-");
  let isMozilla = mozWebExtUrl ||
    (typeof window === "object"
        ? typeof window.wrappedJSObject === "object"
        : "contentScripts" in browser);
  if (isMozilla) {
    if (mozWebExtUrl) {
      // help browser-specific UI styling
      mobile = !("windows" in browser);
      (async () => {
        const cssClasses = ["mozwebext"];
        if (mobile) cssClasses.push("mobile");
        const {vendor} = await browser.runtime.getBrowserInfo();
        const tor = vendor.match(/^(?:Tor|Mullvad)\b/);
        const mullvad = tor && tor[0] == "Mullvad";
        if (tor) cssClasses.push("tor");
        if (mullvad) cssClasses.push("mullvad");
        document.documentElement.classList.add(...cssClasses);
      })();
    }
  } else {
    // shims for non-Mozilla browsers
    if (typeof chrome === "object" && !chrome.tabs) {
      // content script shims
    }
  }

  var UA = {
    isMozilla,
    get mobile() {
      delete this.mobile;
      return this.mobile = mozWebExtUrl
      ? !("windows" in browser)
      : navigator.userAgent.includes("Mobile");
    },
    DEV: true, // DEV_ONLY
  };

  browser.action ??= browser.browserAction;
}
