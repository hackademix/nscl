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

// depends on nscl/content/patchWindow.js
// depends on nscl/content/patchWorkers.js

"use strict";
ns.on("capabilities", event => {
  debug(`WebGLHook on ${document.URL} ${document.readyState} ${document.documentElement && document.documentElement.innerHTML}`, ns.capabilities); // DEV_ONLY
  if (!ns.canScript || ns.allows("webgl") ||
      !("HTMLCanvasElement" in window && document.createElement("canvas").getContext("webgl"))) {
    debug(`WebGLHook bailing out, no need to block webgl  on ${document.URL}.`); // DEV_ONLY
    return;
  }

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
          debug(`WebGLHook called from ${new Error().stack}, ${thisArg}, ${canvas}, ${canvas?.parentElement}`);
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

  const notifyWebGL = canvas => {
    let request = {
      id: "noscript-webgl",
      type: "webgl",
      url: document.URL,
      documentUrl: document.URL,
      embeddingDocument: true,
    };
    seen.record({policyType: "webgl", request, allowed: false});
    notifyPage();
    if (canvas && !(canvas instanceof HTMLCanvasElement)) {
      request.offscreen = true;
      canvas = null;
    }
    try {
      let ph = PlaceHolder.create("webgl", request);
      ph.replace(canvas);
      PlaceHolder.listen();
    } catch (e) {
      error(e);
    }
  }

  let port = patchWindow(modifyGetContext);
  port.onMessage = (msg, {target}) => {
    debug(`WebGLHook msg: ${msg}, target: ${target}`);
    if (msg !== "webgl") return;
    notifyWebGL(target);
  }

  debug(`WebGLHook installed on window ${document.URL}.`);

  if (!(globalThis.OffscreenCanvas && new OffscreenCanvas(0,0).getContext("webgl"))) {
    debug(`WebGLHook: no OffScreenCanvas+webgl, no need to patch workers  on ${document.URL}.`); // DEV_ONLY
    return;
  }

  try {
    const channelID = `webglHook:${uuid()}`;
    const bc = new BroadcastChannel(channelID);
    bc.onmessage = notifyWebGL;
    const workersPatch = () => {
      console.debug("Installing WebGLHook", self); // DEV_ONLY
      const bc = new BroadcastChannel(channelID);
      const getContext = OffscreenCanvas.prototype.getContext;
      const handler = {
        apply: function(targetObj, thisArg, argumentsList) {
          console.debug(`WebGLHook called from ${new Error().stack}`, thisArg, globalThis); // DEV_ONLY
          if (/webgl/i.test(argumentsList[0])) {
            bc.postMessage({});
            return null;
          }
          return getContext.call(thisArg, ...argumentsList);
        }
      };
      OffscreenCanvas.prototype.getContext = new Proxy(getContext, handler);
    };
    patchWorkers(`(${workersPatch})()`.replace(/\bchannelID\b/g, JSON.stringify(channelID)));
    debug(`WebGLHook ready for workers spawned by ${document.URL}.`); // DEV_ONLY
  } catch(e) {
    error(e);
  }
});
