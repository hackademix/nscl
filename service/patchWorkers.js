/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2023 Giorgio Maone <https://maone.net>
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

"use strict";
{
  let patchesByTab = new Map();
  let debugging;

  let cleanup = tabId => {
    if (tabId === -1) return;
    let byOrigin = patchesByTab.get(tabId);
    if (!byOrigin) return;
    patchesByTab.delete(tabId);
    if (debugging) {
      debugging.dispose(tabId);
    }
    let serviceWorkers = patchesByTab.get(-1);
    if (serviceWorkers) {
      for (let origin of byOrigin.keys()) {
        serviceWorkers.delete(origin);
      }
    }
  };

  browser.tabs.onRemoved.addListener(tab => {
    cleanup(tab.id);
  });
  browser.webNavigation.onCommitted.addListener(({tabId, frameId}) => {
    if (frameId === 0) cleanup(tabId);
  });
  // ensure the patches run only in Worker scopes
  let wrap = patch => `(() => {
    try {
      if (!(self instanceof WorkerGlobalScope)) return false;
    } catch(e) {
      return false;
    }
    ${patch};
    return true;
  })();
  `;

  browser.runtime.onMessage.addListener(({__patchWorkers__}, {tab, url: documentUrl}) => {
    if (!__patchWorkers__) return;
    try {
      let {url, patch, isServiceOrShared} = __patchWorkers__;
      let tabId = isServiceOrShared && !chrome.debugger ? -1 : tab.id;
      let byOrigin = patchesByTab.get(tabId);
      if (!byOrigin) patchesByTab.set(tabId, byOrigin = new Map());
      let patchInfo = byOrigin.get(documentUrl);
      if (!patchInfo) byOrigin.set(documentUrl, patchInfo = {patch, urls: new Set()});
      else {
        patchInfo.patch = patch;
      }
      patchInfo.urls.add(url);

      return Promise.resolve(init(tab.id, url, patchInfo));
    } catch (e) {
      console.error("Error on __patchWorkers__ message", e);
      return Promise.reject(e);
    }
  });

  let init = browser.webRequest.filterResponseData ? () => {
    // Firefox, filter the source from the network
    init = () => {}; // attach the listener just once
    browser.webRequest.onBeforeRequest.addListener(request => {
      let {tabId, url, documentUrl, requestId} = request;
      let byOrigin = patchesByTab.get(tabId);
      if (!byOrigin) return;
      let patchInfo = byOrigin.get(documentUrl);
      if (!(patchInfo && patchInfo.urls.has(url))) return;

      let filter = browser.webRequest.filterResponseData(requestId);
      filter.onstart = event => {
        filter.write(new TextEncoder().encode(wrap(patchInfo.patch)));
        filter.disconnect();
      };
    }, {
      urls: ["<all_urls>"],
      types: ["script"],
    }, ["blocking"]);
  } : async (...args) => {

    // Section 1, run once

    // Chromium, use debugger breakpoints
    if (!chrome.debugger) {
      throw new Error("patchWorker.js - no debugger API: missing permission?");
    }

    let makeAsync = (api, method) => {
      return new Proxy(api[method], {
        apply(target, thisArg, args) {
          return new Promise((resolve, reject) => {
            let callback = (...r) => {
              console.debug("%s ret", target.name, args, r);
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(r.length > 1 ? r : r[0]);
              }
            };
            target.call(api, ...args, callback);
          });
        }
      });
    };

    let dbg = {};
    for (let [key, prop] of Object.entries(chrome.debugger)) {
      if (typeof prop === "function") dbg[key] = makeAsync(chrome.debugger, key);
    }

    debugging = new Map();
    debugging.dispose = async function(tabId) {
      let dbgInfo = await this.get(tabId);
      if (dbgInfo) return await dbgInfo.dispose();
      return false;
    }

    chrome.debugger.onEvent.addListener(async (source, method, params) => {
      let {tabId} = source;
      let dbgInfo = await debugging.get(tabId);
      if (!dbgInfo || method === "Debugger.scriptParsed") return; // shouldn't happen
      console.debug("Debugger event", method, params);

      switch(method) {
        case "Debugger.scriptFailedToParse":
          return await dbgInfo.dispose(params.url);
        case "Target.attachedToTarget": {
          return dbgInfo.handleWorker(params);
        }
      }
    });

    chrome.debugger.onDetach.addListener((source, reason) => {
      console.log("Detached debugger from", source, reason);
      if (source.tabId) debugging.dispose(source.tabId);
    });

    // Section 2, run from now on

    return await (init = async (tabId, url, {patch}) => {

      let target = {tabId};
      let dbgInfo = await debugging.get(tabId);
      if (!dbgInfo) {
        let cmd = async (command, params) => await dbg.sendCommand(target, command.includes(".") ? command : `Debugger.${command}`, params);
        let startingDebugger = (async () => {
          let targets = await dbg.getTargets();
          if (!(targets.some(t => t.attached && t.tabId === tabId))) {
            console.debug("Attaching debugger to", tabId);
            try {
              await dbg.attach(target, "1.3");
            } catch (e) {
              // might just be because we're already attached
              console.error(e);
            }
          }
          await cmd("enable");
          await cmd("Target.setAutoAttach", {autoAttach: true, waitForDebuggerOnStart: true, flatten: true});

          return {
            dbg, cmd, target,
            patches: new Map(),
            async handleWorker({sessionId, targetInfo}) {
              let {url, type, targetId, waitingForDebugger, attached} = targetInfo;
              let {cmd, dbg, patches} = this;
              let worker = {targetId};
              try {
                await dbg.attach(worker, "1.3");
                if (!patches.has(url) || type !== "worker") return;
                let expression = wrap(patches.get(url).code);
                console.log("Patching", url, expression);
                try {
                  await dbg.sendCommand(worker, "Runtime.evaluate", {expression, silent: true, allowUnsafeEvalBlockedByCSP: true});
                } catch (e) {
                  console.error("Runtime.evaluate failed", e);
                } finally {
                  this.dispose(url);
                }
              } catch (e) {
                console.error("Attaching failed", e);
              } finally {
                if (waitingForDebugger || attached) {
                  await dbg.sendCommand(worker, "Runtime.runIfWaitingForDebugger");
                  await dbg.detach(worker);
                }
              }
            },
            patch(url, code) {
              let patch = this.patches.get(url);
              if (!patch) {
                this.patches.set(url, patch = {url, code, count: 1});
              } else {
                patch.code = code;
                patch.count++;
              }
            },
            async dispose(url) {
              let {patches} = this;
              if (!url) {
                return await Promise.all([...patches.keys()].map(u => this.dispose(u)));
              }
              if (patches.has(url) && patches.get(url).count-- <= 1) {
                patches.delete(url);
                if (patches.size === 0) {
                  console.debug("Detaching debugger from tab", this.target.tabId);
                  try {
                    await cmd("Target.setAutoAttach", {autoAttach: false});
                  } catch (e) {
                    console.error(e);
                  }
                  try {
                    await this.dbg.detach(this.target);
                  } catch (e) {
                    console.error(e);
                  }
                  debugging.delete(this.target.tabId);
                }
              }
            }
          };
        })();
        debugging.set(tabId, startingDebugger);
        dbgInfo = await startingDebugger;
      }
      dbgInfo.patch(url, patch);
    })(...args);
  };
}
