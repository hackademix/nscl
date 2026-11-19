
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
    console.debug("WasmHook deleting WebAssembly", scope); // DEV_ONLY
    Reflect.deleteProperty(xray.unwrap(scope), "WebAssembly");

    // Capture the intrinsics and event accessors used by the asynchronous
    // listeners, before page code has an opportunity to tamper with them.
    const apply = Reflect.apply;
    const regexpTest = RegExp.prototype.test;
    const wasmPattern = /\bWebAssembly\b/;
    const portPostMessage = port.postMessage;

    const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const errorMessageGetter =
      getOwnPropertyDescriptor(ErrorEvent.prototype, "message")?.get;
    const rejectionReasonGetter =
      getOwnPropertyDescriptor(PromiseRejectionEvent.prototype, "reason")?.get;

    for (const event of ["error", "unhandledrejection", "rejectionhandled"]) {
      addEventListener(event, e => {
        if (!e.isTrusted) return;

        let message;
        if (event === "error") {
          message = apply(errorMessageGetter, e, []);
        } else {
          const reason = apply(rejectionReasonGetter, e, []);
          try {
            message = reason?.message;
          } catch (_) {
            return;
          }
        }

        if (apply(regexpTest, wasmPattern, [`${message}`])) {
          apply(portPostMessage, port, ["notify"]);
        }
      }, true);
    }
  }

  Worlds.connect("WasmHook.main", {
    onMessage(msg, {port}) {
      console.debug("WasmHook received message", msg); // DEV_ONLY
      switch(msg) {
        case "patchWindow":
          patchWindow(modifyWindow, {port});
          break;
      }
    }
  });
}
