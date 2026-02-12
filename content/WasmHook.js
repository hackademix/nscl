/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2025 Giorgio Maone <https://maone.net>
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
  debug(`WasmHook on ${document.URL} ${document.readyState} ${document.documentElement?.innerHTML}`, ns.capabilities); // DEV_ONLY
  if (!ns.canScript || ns.allows("wasm") ||
      !("WebAssembly" in globalThis)) {
    debug(`WasmHook bailing out, no need to block WebAssembly  on ${document.URL}.`); // DEV_ONLY
    return;
  }

  const notify = () => {
    let request = {
      id: "noscript-wasm",
      type: "wasm",
      url: document.URL,
      documentUrl: document.URL,
      embeddingDocument: true,
      offscreen: true,
    };
    seen.record({policyType: "wasm", request, allowed: false});
    notifyPage();
    try {
      PlaceHolder.create("wasm", request).replace();
    } catch (e) {
      error(e);
    }
  }

  Worlds.connect("WasmHook", {
    onConnect(port) {
      debug(`WasmHook connected, sending patchWindow`); // DEV_ONLY
      port.postMessage("patchWindow");
    },
    onMessage: m => {
      switch(m) {
        case "notify":
          notify();
        break;
      }
    },
  });

  debug(`WasmHook installed on window ${document.URL}.`);

  try {
    const channelID = `wasmHook:${self.location.href}:${uuid()}`;
    try {
      const bc = new BroadcastChannel(channelID);
      bc.onmessage = notify;
    } catch (e) {
      console.error(e, `Cannot use BroadCastChannel ${channelID} - but we're fine.`);
    }
    const workersPatch = () => {
      console.debug("Installing WasmHook", self); // DEV_ONLY

      console.debug("WasmHook deleting WebAssembly", self); // DEV_ONLY
      Reflect.deleteProperty(self, "WebAssembly");

      for (const event of ["error", "unhandledrejection", "rejectionhandled"]) {
        addEventListener(event, e => {

          console.error(e, "Error handler", e.reason, e.message, e.reason?.message, e.isTrusted);
          if (e.isTrusted && /\bWebAssembly\b/.test(`${e.message} ${e.reason?.message}`)) {
            try {
              const bc = new BroadcastChannel(channelID);
              bc.postMessage({});
              bc.close();
              console.log("Used BroadcastChannel", channelID);
            } catch (e) {
              console.error(e, `Cannot use BroadCastChannel ${channelID} - but we're fine.`);
            }
          }
        }, true);
      }
    };
    patchWorkers(`(${workersPatch})()`.replace(/\bchannelID\b/g, JSON.stringify(channelID)));
    debug(`WasmHook ready for workers spawned by ${document.URL}.`); // DEV_ONLY
  } catch(e) {
    error(e);
  }
});
