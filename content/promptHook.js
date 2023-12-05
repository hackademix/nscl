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

// depends on nscl/content/patchWindow.js
// depends on nscl/common/Messages.js
"use strict";

ns.on("capabilities", () => {
  if (!patchWindow.xrayEnabled || !ns.canScript) {
    // hook scripting-enabled pages on Firefox only
    return;
  }

  debug("Prompt Hook installation", document.URL); // DEV_ONLY
  const patchPrompts = (scope, {port, xray}) => {
    for (let methodName of ["alert", "confirm", "prompt"]) {
      let target = xray.unwrap(methodName in scope.__proto__ ? scope.__proto__ : scope);
      let method = xray.getSafeMethod(target, methodName);
      const patched = function(...args) {
        try {
          return method.call(this, ...args);
        } finally {
          try {
            port.postMessage("prompt", target);
          } catch(e) {
            // dead port object, extension removed?
          }
        }
      }
      exportFunction(patched, scope, {defineAs: methodName});
    }
  };

  const port = patchWindow(patchPrompts);
  port.onMessage = msg => {
    if (msg !== "prompt") return;
    debug("Prompt Hook triggered"); // DEV_ONLY
    Messages.send("promptHook");
  }
});
