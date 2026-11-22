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

// depends on nscl/content/Worlds.js
// depends on nscl/content/patchWorkers.js

"use strict";
ns.on("capabilities", event => {
  debug(`WebGLHook on ${document.URL} ${document.readyState} ${document.documentElement?.innerHTML}`, ns.capabilities); // DEV_ONLY

  const createCanvas = () => document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  try {
    if (!ns.canScript || ns.allows("webgl") ||
      !("HTMLCanvasElement" in window && createCanvas()?.getContext("webgl"))) {
      debug(`WebGLHook bailing out, no need to block webgl  on ${document.URL}.`); // DEV_ONLY
      // connect anyway to correctly end worlds
      Worlds.connect("WebGLHook");
      return;
    }
  } catch (e) {
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
    } catch (e) {
      error(e);
    }
  }

  function panicAbort() {
    const html = document.documentElement.outerHTML;
    const scriptBlocker = `<head><meta http-equiv="content-security-policy" content="script-src 'none'"></head>`;
    DocRewriter.rewrite(scriptBlocker);
    DocRewriter.rewrite(html);

    const target = document.body.appendChild(createCanvas());
    target.style = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%";
    notifyWebGL(target);
  }

  Worlds.connect("WebGLHook", {
    onConnect(port) {
      debug(`WebGLHook connected, sending patchWindow`); // DEV_ONLY
      port.postMessage("patchWindow");
    },
    onMessage(msg, {port, event}) {
      const {target} = event;
      debug(`WebGLHook msg: ${msg}, target: ${target}`); // DEV_ONLY
      switch(msg) {
        case "notify":
          notifyWebGL(target);
          break;
        case "panic":
          console.error("Too many consecutive blocked webgl contexts, trying to break the loop.");
          panicAbort();
          break;
      }
    }
  });

  debug(`WebGLHook installed on window ${document.URL}.`);

  if (!(globalThis.OffscreenCanvas && new OffscreenCanvas(0,0).getContext("webgl"))) {
    debug(`WebGLHook: no OffScreenCanvas+webgl, no need to patch workers  on ${document.URL}.`); // DEV_ONLY
    return;
  }

  try {
    const channelID = `webglHook:${globalThis.location?.href}:${uuid()}`;
    try {
      const bc = new BroadcastChannel(channelID);
      bc.onmessage = notifyWebGL;
    } catch (e) {
      console.error(e, `Cannot use BroadCastChannel ${channelID} - but we're fine.`);
    }
    const workersPatch = () => {
      const { OffscreenCanvas: CanvasClass } = globalThis;
      if (!CanvasClass) {
        return;
      }
      console.debug("Installing WebGLHook", globalThis, globalThis.location?.href); // DEV_ONLY
      const getContext = CanvasClass.prototype.getContext;

      // Capture intrinsics used by the handler before page code can tamper with them.
      const { apply } = Reflect;

      const regexpExec = RegExp.prototype.exec;
      const webglPattern = /webgl/i;
      const { BroadcastChannel } = globalThis;
      const { postMessage, close } = BroadcastChannel.prototype;

      // Brand check canvases by calling their native width getter
      // to avoid prototype tampering pitfalls
      const canvasWidthGetter =
        Object.getOwnPropertyDescriptor(CanvasClass.prototype, "width").get;
      const isCanvas = canvas => {
        try {
          apply(canvasWidthGetter, canvas, []);
          return true;
        } catch (e) {
          return false;
        }
      };


      const handler = {
        // prevent inherited traps
        __proto__: null,
        apply: function(targetObj, thisArg, argumentsList) {
          console.debug(`WebGLHook called from ${new Error().stack}`, thisArg, globalThis); // DEV_ONLY
          if (isCanvas(thisArg) &&
            // coerce once if needed
            argumentsList.length &&
            (argumentsList[0] = `${argumentsList[0]}`) &&
            apply(regexpExec, webglPattern, [argumentsList[0]]) !== null
          ) {
            try {
              const bc = new BroadcastChannel(channelID);
              apply(postMessage, bc, [{}]);
              apply(close, bc, []);
            } catch (e) {
              // Cannot use BroadcastChannel, but we're fine.
            }
            return null;
          }
          return apply(getContext, thisArg, argumentsList);
        }
      };
      CanvasClass.prototype.getContext = new Proxy(getContext, handler);
    };
    patchWorkers(`(${workersPatch})()`.replace(/\bchannelID\b/g, JSON.stringify(channelID)));
    debug(`WebGLHook ready for workers spawned by ${document.URL}.`); // DEV_ONLY
  } catch(e) {
    error(e);
  }
});
