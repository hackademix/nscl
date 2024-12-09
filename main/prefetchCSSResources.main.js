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

// depends on /nscl/main/Worlds.js
// depends on /nscl/main/Worlds.main.js

"use strict";
{
  const {console, exportFunction, patchWindow} = Worlds.main;

  const modifyWindow = (win, {port, xray}) => {
    console.debug("prefetchCSSResources init"); // DEV_ONLY

    const { window } = xray;
    const { StyleSheet } = win;
    const ssProto = StyleSheet.prototype;
    const cssProto = win.CSSStyleSheet.prototype;
    // prevent getting fooled by redefined getters
    const getOwnerNode = Object.getOwnPropertyDescriptor(ssProto, "ownerNode").get;

    const postMessage = (msg, target) => {
      if (target instanceof StyleSheet) target = getOwnerNode.apply(target);
      return target && port.postMessage(msg, target);
    };

    if (!xray.enabled) {
      // Chromium (only?) requires relaxed CORS and therefore needs
      // cssRules protection denying access to "privileged" cross-site links.
      for (const prop of ["rules", "cssRules"]) {
        const originalGetter = Object.getOwnPropertyDescriptor(cssProto, prop).get;
        exportFunction(function() {
          if (!postMessage("accessRules", this)) {
            throw new DOMException("Security Error",
              `Failed to read the '${prop}' property from 'CSSStyleSheet': Cannot access rules`);
          }
          return originalGetter.apply(this);
        }, cssProto, {defineAs: `get ${prop}`});
      }
    }

    const mmProto = win.MediaList.prototype;
    const { appendMedium, deleteMedium, item } = mmProto;
    // make disable property temporarily readonly if tagged as keepDisabled
    for (const proto of [ssProto, win.HTMLStyleElement.prototype, win.HTMLLinkElement.prototype]) {
      const prop = "media";
      const des = xray.getSafeDescriptor(proto, prop, "get");
      exportFunction(function(value) {
        if (postMessage("isDisabled", this)) {
          if (this instanceof StyleSheet) {
            return new Proxy(this.media, {
              get(target, prop, receiver) {
                if (typeof target[prop] === "function") {
                  return new Proxy(target[prop], {
                    apply(target, that, args) {
                      if (target === appendMedium || target === deleteMedium) {
                        return;
                      }
                      if (target === item) {
                        return null;
                      }
                      return Reflect.apply(...arguments);
                    }
                  });
                }
                switch(prop) {
                  case "length":
                    return 0;
                  case "mediaText":
                    return ""
                }
                return Reflect.get(...arguments);
              },
              set(target, prop, newVal) {
                switch(prop) {
                  case "mediaText": return true;
                }
                return Reflect.set(...arguments);
            }
            });
          }
          return "";
        }
        return des.get.call(this, value);
      }, proto, {defineAs: `get ${prop}`});
      exportFunction(function(value) {
        if (postMessage("isDisabled", this)) {
          return value;
        }
        return des.set.call(this, value);
      }, proto, {defineAs: `set ${prop}`});
    }
  };

  Worlds.connect("prefetchCSSResources.main", {
    onMessage(msg, {port}) {
      switch(msg) {
        case "patchWindow":
          patchWindow(modifyWindow, {port});
          break;
      }
    }
  });
}