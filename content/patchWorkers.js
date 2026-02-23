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

"use strict";
globalThis.patchWorkers = (() => {
  const patches = new Set();
  let propagator = "";

  let stringify = f => typeof f === "function" ? `(${f})();\n` : `{${f}}\n`;

  const debugMonitor = `
    if (globalThis.addEventListener) for (const et of ['message', 'error', 'messageerror']) {
      addEventListener(et, ev => {
        console.debug("Event in patched worker/worklet", globalThis, ev.type, ev.data);
      }, true);
    }`;
  const wrap = code => `{
    let parentPatch = () => {
      if (!(globalThis.WorkerGlobalScope || globalThis.WorkletGlobalScope)) {
        console.debug("Excluding from worker/worklet patching", globalThis); // DEV_ONLY
        return false;
      }
      // preserve console from rewriting / erasure
      const console = Object.fromEntries(Object.entries(globalThis.console).map(([n, v]) => v.bind ? [n, v.bind(globalThis.console)] : [n,v]));
      ${debugMonitor} // DEV_ONLY
      try {
        ${code}
      } catch(e) {
        console.error("Error executing worker/worklet patch", e);
      }
    };
    ${propagator}
    parentPatch();
  };`
  ;
  const joinPatches = () => wrap([...patches].join("\n"));

  browser.runtime.onMessage.addListener(({ __getWorkerPatch__ }) =>
    __getWorkerPatch__ ? joinPatches() : undefined
  );

  return patch => {

    if (patches.size === 0) {
      Worlds.connect("patchWorkers", {
        onMessage(msg, {port}) {
          switch (msg.type) {
            case "propagate":
              // This is almost duplicated in patchWorker.main.js / modifyContext itself
              propagator = `
                const modifyContext = ${msg.modifyContext};
                modifyContext(null, {});
              `;
              break;
            case "getPatch":
              return joinPatches();
            case "patchUrl":
            {
              let {url, isServiceOrShared} = msg;
              url = `${url}`;
              const workerCreatedMsg = {
                __patchWorkers__: { url, patch: joinPatches(), isServiceOrShared }
              };
              browser.runtime.sendMessage(workerCreatedMsg).then(r => {
                port.postMessage({ type: "patchedUrl", url });
              }, e => {
                console.error(e, "Could not patch", url); // DEV_ONLY
                // terminate / unregister workers which could not be patched
                port.postMessage({type: "cancelUrl", url});
              });
            }
          }
        }
      });
    }

    patches.add(stringify(patch));
  }
})();
