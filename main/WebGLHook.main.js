
/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2026 Giorgio Maone <https://maone.net>
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
  const {console, cloneInto, patchWindow} = Worlds.main;

  function modifyWindow(scope, {port, xray}) {
    console.debug("WebGLHook patching", scope); // DEV_ONLY

    const unwrappedScope = xray.unwrap(scope);

    for (const canvas of ["HTMLCanvasElement", "OffscreenCanvas"]) {
      if (!(canvas in scope)) continue;

      // CAVEAT:
      // we must use the X-Ray wrapper from window/globalThis for instanceof,
      // but proxy the wrapped getContext method from unprivileged scope, see
      // https://forums.informaction.com/viewtopic.php?p=104382

      const CanvasClass = unwrappedScope[canvas];
      const getContext = xray.getSafeMethod(scope[canvas].prototype, "getContext");

      const MAX_CONSECUTIVE = 20;
      let consecutive = 0;
      let lastTime = 0;
      let panic = false;

      // Capture the intrinsics and methods used by the handler, which may
      // execute after page code has had an opportunity to tamper with them.
      const apply = Reflect.apply;
      const hasInstance = Function.prototype[Symbol.hasInstance];
      const regexpTest = RegExp.prototype.test;
      const dateNow = Date.now;
      const webglPattern = /webgl/i;
      const portPostMessage = port.postMessage;
      const documentRef = unwrappedScope.document;
      const documentContains = documentRef?.contains;

      const handler = cloneInto({
        apply: function(targetObj, thisArg, argumentsList) {
          console.debug(`WebGLHook called from ${new Error().stack}, ${thisArg}, ${canvas}, ${canvas?.parentElement}`); // DEV_ONLY

          if (
            apply(hasInstance, CanvasClass, [thisArg]) &&
            apply(regexpTest, webglPattern, [argumentsList[0]])
          ) {
            if (panic) {
              return null;
            }

            const target =
              canvas === "HTMLCanvasElement" &&
              apply(documentContains, documentRef, [thisArg])
                ? thisArg
                : scope;

            const t = apply(dateNow, Date, []);

            if (t - lastTime < 5 && consecutive++ > MAX_CONSECUTIVE) {
              panic = true;
              apply(portPostMessage, port, ["panic"]);
            } else {
              apply(portPostMessage, port, ["notify", target]);
              lastTime = t;
            }

            return null;
          }

          return apply(getContext, thisArg, argumentsList);
        }
      }, scope, {cloneFunctions: true});

      const proxy = new scope.Proxy(getContext, handler);
      scope[canvas].prototype.getContext = proxy;
    }
  }

  Worlds.connect("WebGLHook.main", {
    onMessage(msg, {port}) {
      console.debug("WebGLHook received message", msg); // DEV_ONLY
      switch(msg) {
        case "patchWindow":
          patchWindow(modifyWindow, {port});
          break;
      }
    }
  });
}
