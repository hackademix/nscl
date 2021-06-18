/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2021 Giorgio Maone <https://maone.net>
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
  let mobile = false;
  if (isMozilla) {
    if (mozWebExtUrl) {
      // help browser-specific UI styling
      document.documentElement.classList.add("mozwebext");
      mobile = !("windows" in browser);
    }
  } else {
    // shims for non-Mozilla browsers
    if (typeof chrome === "object" && !chrome.tabs) {
      // content script shims
    }
  }

  var UA = {
    isMozilla,
    mobile,
  };
}
