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

  const notifyWasm = () => {
    let request = {
      id: "noscript-wasm",
      type: "wasm",
      url: document.URL,
      documentUrl: document.URL,
      embeddingDocument: true,
    };
    seen.record({policyType: "wasm", request, allowed: false});
    notifyPage();
  }

  addEventListener("error", e => {
    if (/Error.*WebAssembly/.test(e.message)) {
      notifyWasm();
    }
  }, true);

  Worlds.connect("WasmHook", {
    onConnect(port) {
      debug(`WasmHook connected, sending patchWindow`); // DEV_ONLY
      port.postMessage("patchWindow");
    },
    onMessage: m => {
    },
  });

  debug(`WasmLHook installed on window ${document.URL}.`);
});
