/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2023 Giorgio Maone <https://maone.net>
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

"use strict";

function CapsCSP(baseCSP = new CSP()) {
  return Object.assign(baseCSP, {
    types: ["script", "object", "media", "font"],
    dataUriTypes: ["font", "media", "object"],
    buildFromCapabilities(capabilities, blockHttp = false) {
      let forbidData = new Set(this.dataUriTypes.filter(t => !capabilities.has(t)));
      let blockedTypes = new Set(this.types.filter(t => !capabilities.has(t)));
      if(!capabilities.has("script")) {
        blockedTypes.add({name: "script-src-elem"});
        blockedTypes.add({name: "script-src-attr"});
        blockedTypes.add("worker");
        if (!blockedTypes.has("object")) {
          // data: URIs loaded in objects may run scripts
          blockedTypes.add({type: "object", value: "http:"});
        }
      }

      if (!blockHttp) {
        // HTTP is blocked in onBeforeRequest, let's allow it only and block
        // for instance data: and blob: URIs
        for (let type of this.dataUriTypes) {
          if (blockedTypes.delete(type)) {
            blockedTypes.add({type, value: "http:"});
          }
        }
      }

      return blockedTypes.size ? this.buildBlocker(...blockedTypes) : null;
    }
  });
}
