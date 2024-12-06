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

  let stringify = f => typeof f === "function" ? `(${f})();\n` : `{${f}}\n`;

  const debugMonitor = `
    for (let et of ['message', 'error', 'messageerror']) {
      addEventListener(et, ev => {
        console.debug("%s Event in patched worker", ev.type, ev.data);
      }, true);
    }`;
  const wrap = code => `(() => {
    try {
      if (!(self instanceof WorkerGlobalScope)) return false;
    } catch(e) {
      return false;
    }

    // preserve console from rewriting / erasure
    const console = Object.fromEntries(Object.entries(self.console).map(([n, v]) => v.bind ? [n, v.bind(self.console)] : [n,v]));

    ${debugMonitor} // DEV_ONLY
    try {
      ${code};
    } catch(e) {
      console.error("Error executing worker patch", e);
    }
    return true;
  })();
  `;
  const joinPatches = () => wrap([...patches].join("\n"));

  return patch => {

    if (patches.size === 0) {
      Worlds.connect("patchWorkers", {
        onMessage(msg, {port}) {
          switch(msg.type) {
            case "getPatch":
              return joinPatches();
            case "patchUrl":
            {
              let {url, isServiceOrShared} = msg;
              url = `${url}`;
              browser.runtime.sendMessage({
                __patchWorkers__: { url, patch: joinPatches(), isServiceOrShared }
              }).then(r => {}, e => {
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