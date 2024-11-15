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
  const {console} = Worlds.main;

  let patchGetContext = (scope, port) => {
    patchGetContext = () => {}; // one shot
    console.log("WebGLHook patching", scope);
    for (let canvas of ["HTMLCanvasElement", "OffscreenCanvas"]) {
      if (!(canvas in scope)) continue;

      const CanvasClass = scope[canvas];
      const {getContext} = scope[canvas].prototype;

      const MAX_CONSECUTIVE = 20;
      let consecutive = 0;
      let lastTime = 0;
      let panic = false;
      const handler = {
        apply: function(targetObj, thisArg, argumentsList) {
          console.debug(`WebGLHook called from ${new Error().stack}, ${thisArg}, ${canvas}, ${canvas?.parentElement}`);
          if (thisArg instanceof CanvasClass && /webgl/i.test(argumentsList[0])) {
            if (panic) {
              return null;
            }
            const target = canvas === "HTMLCanvasElement" && document.contains(thisArg) ? thisArg : scope;
            const t = Date.now();
            if (t - lastTime < 5 && consecutive++ > MAX_CONSECUTIVE) {
              console.error("Too many consecutive blocked webgl contexts, trying to break the loop.");
              panic = true;
              port.postMessage("panic");
            } else {
              port.postMessage("notify", target);
              lastTime = t;
            }
            return null;
          }
          return getContext.call(thisArg, ...argumentsList);
        }
      };

      const proxy = new Proxy(getContext, handler);
      scope[canvas].prototype.getContext = proxy;
    }
  }

  Worlds.connect({
    onMessage(msg, {port}) {
      console.debug("WebGLHook received message", msg); // DEV_ONLY
      switch(msg) {
        case "patchGetContext":
          patchGetContext(globalThis, port);
          break;
      }
    }
  });
}
