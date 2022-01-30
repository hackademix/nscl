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

// depends on nscl/content/patchWindow.js
"use strict";
ns.on("capabilities", event => {
  debug("WebGL Hook", document.URL, document.documentElement && document.documentElement.innerHTML, ns.capabilities); // DEV_ONLY
  if (ns.allows("webgl")) return;

  function modifyGetContext(scope, {port, xray}) {
    let dispatchEvent = EventTarget.prototype.dispatchEvent;
    let { Event } = scope;
    for (let canvas of ["HTMLCanvasElement", "OffscreenCanvas"]) {
      if (!(canvas in scope)) continue;

      // CAVEAT:
      // we must use the X-Ray wrapper from window/globalThis for instanceof,
      // but proxy the wrapped getContext method from unprivileged scope, see
      // https://forums.informaction.com/viewtopic.php?p=104382

      const CanvasClass = globalThis[canvas];
      // globalThis future-proofs us for when we dare patchWorkers()

      const getContext = xray.getSafeMethod(scope[canvas].prototype, "getContext");

      const handler = cloneInto({
        apply: function(targetObj, thisArg, argumentsList) {
          if (thisArg instanceof CanvasClass && /webgl/i.test(argumentsList[0])) {
            let target = canvas === "HTMLCanvasElement" && document.contains(thisArg) ? thisArg : scope;
            port.postMessage("webgl", target);
            return null;
          }
          return getContext.call(thisArg, ...argumentsList);
        }
      }, scope, {cloneFunctions: true});

      const proxy = new scope.Proxy(getContext, handler);
      scope[canvas].prototype.getContext = proxy;
    }
  }

  let port = patchWindow(modifyGetContext);
  port.onMessage = (msg, {target: canvas}) => {
    if (msg !== "webgl") return;
    let request = {
      id: "noscript-webgl",
      type: "webgl",
      url: document.URL,
      documentUrl: document.URL,
      embeddingDocument: true,
    };
    seen.record({policyType: "webgl", request, allowed: false});
    if (canvas instanceof HTMLCanvasElement) {
      try {
        let ph = PlaceHolder.create("webgl", request);
        ph.replace(canvas);
        PlaceHolder.listen();
      } catch (e) {
        error(e);
      }
    }
    notifyPage();
  }
});
