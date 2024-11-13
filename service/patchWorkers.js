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

  browser.runtime.onMessage.addListener(({__patchWorkers__}, {tab, url: documentUrl}) => {
    if (!__patchWorkers__) return;
    try {
      let {url, patch, isServiceOrShared} = __patchWorkers__;
      let tabId = isServiceOrShared && !chrome.debugger ? -1 : tab.id;
      let byOrigin = patchesByTab.get(tabId);
      if (!byOrigin) patchesByTab.set(tabId, byOrigin = new Map());
      if (tabId == -1) {
        documentUrl = new URL(documentUrl).origin;
      }
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
      console.debug("patchesByTab", patchesByTab, request); // DEV_ONLY REMOVEME
      let byOrigin = patchesByTab.get(tabId);
      if (!byOrigin) return;
      if (tabId == -1) {
        documentUrl = new URL(documentUrl).origin;
      }
      let patchInfo = byOrigin.get(documentUrl);
      if (!(patchInfo && patchInfo.urls.has(url))) return;

      console.debug(`Patching ${tabId == -1 ? 'service' : ''}worker`, requestId, url, documentUrl); // DEV_ONLY REMOVEME
      let filter = browser.webRequest.filterResponseData(requestId);
      filter.onstart = () => {
        console.debug("filter.onstart", requestId);  // DEV_ONLY REMOVEME
        filter.write(new TextEncoder().encode(patchInfo.patch));
      };
      filter.ondata = e => {
        filter.write(e.data);
      };
      filter.onstop = () => {
        filter.close();
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

    const patchedTargets = new Set();

    let makeAsync = (api, method) => {
      return new Proxy(api[method], {
        apply(target, thisArg, args) {
          return new Promise((resolve, reject) => {
            let callback = (...r) => {
              console.debug("%s ret", target.name, args, r); // DEV_ONLY
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

    const dbg = {};
    for (let [key, prop] of Object.entries(chrome.debugger)) {
      if (typeof prop === "function") dbg[key] = makeAsync(chrome.debugger, key);
    }

    debugging = new Map();
    debugging.dispose = async function(tabId) {
      let dbgInfo = await this.get(tabId);
      if (dbgInfo) {
        try {
          return await dbgInfo.dispose();
        } catch (e) {
          console.error(e);
        }
      }
      return false;
    }

    chrome.debugger.onEvent.addListener(async (source, method, params) => {
      let {tabId} = source;
      let dbgInfo = await debugging.get(tabId);
      if (!dbgInfo || method === "Debugger.scriptParsed") return; // shouldn't happen
      console.debug("Debugger event", method, params, source); // DEV_ONLY

      switch(method) {
        case "Debugger.scriptFailedToParse":
          return await dbgInfo.dispose(params.url);
        case "Target.attachedToTarget": {
          return dbgInfo.handleWorker(source, params);
        }
      }
    });

    chrome.debugger.onDetach.addListener((source, reason) => {
      console.log("Detached debugger from", source, reason);
      if (source.tabId) debugging.dispose(source.tabId);
    });

    // Section 2, run from now on

    // see https://chromedevtools.github.io/devtools-protocol/tot/Target/#type-TargetFilter
    // and https://source.chromium.org/chromium/chromium/src/+/main:content/browser/devtools/devtools_agent_host_impl.cc?ss=chromium&q=f:devtools%20-f:out%20%22::kTypeTab%5B%5D%22
    const targetFilter = ["worker", "shared_worker", "service_worker"].map(type => ({type, exclude: false}));

    return await (init = async (tabId, url, {patch}) => {

      const dbgTarget = {tabId};
      let dbgInfo = await debugging.get(tabId);
      if (!dbgInfo) {
        const cmd = async (command, params) => await dbg.sendCommand(dbgTarget, command, params);
        const startingDebugger = (async () => {
          try {

            console.debug("Attaching debugger to", tabId); // DEV_ONLY
            try {
              await dbg.attach(dbgTarget, "1.3");
            } catch (e) {
              // might just be because we're already attached
              console.error(e);
            }

            await cmd("Debugger.enable");
            await cmd("Target.setAutoAttach", {
              autoAttach: true,
              waitForDebuggerOnStart: true,
              flatten: true,
              targetFilter,
            });
          } catch (e) {
            console.error(e);
            throw e;
          }
          console.debug("NoScript's patchWorker started debugger on ", tabId);
          return {
            sessions: 0,
            patches: new Map(),
            async handleWorker(source, {sessionId, targetInfo, waitingForDebugger}) {
              const {url, type, targetId} = targetInfo;

              const targetKey = `${type}:${url}|T${tabId}:${targetId}`;
              if (patchedTargets.has(targetKey)) return;

              const {patches} = this;
              const session = {...source, sessionId};
              try {
                if (!(patches.has(url) && /worker$/.test(type))) return;
                patchedTargets.add(targetKey);
                this.sessions++;
                const expression = patches.get(url).code;
                console.debug("Session %s (%s, %s), patching %s", sessionId, this.sessions, waitingForDebugger, url/*, expression */); // DEV_ONLY
                if (waitingForDebugger) {
                  try {
                    await dbg.sendCommand(session, "Runtime.runIfWaitingForDebugger");
                  } catch (e) {
                    console.error(e);
                  }
                }
                try {
                  await dbg.sendCommand(session, "Runtime.evaluate", {
                    expression,
                    silent: true,
                    allowUnsafeEvalBlockedByCSP: true,
                  });
                } catch (e) {
                  console.error("Runtime.evaluate failed", e);
                }
              } catch (e) {
                console.error("Attaching failed", e);
              } finally {
                if (waitingForDebugger) {
                  try {
                    await dbg.sendCommand(session, "Runtime.runIfWaitingForDebugger");
                  } catch (e) {
                    console.error(e);
                  }
                } else {
                  try {
                   await dbg.sendCommand(session, "Target.detachFromTarget", {sessionId});
                  } catch (e) {
                    console.error(e);
                  }
                }
              }
              this.sessions--;
              console.debug("Done with session %s (%s, %s)", sessionId, this.sessions, waitingForDebugger);
              await this.dispose(url);
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
              }
              if (patches.size === 0 && this.sessions == 0) {
                console.debug("Detaching debugger from tab", dbgTarget.tabId); // DEV_ONLY
                try {
                  await cmd("Target.setAutoAttach", {autoAttach: false, waitForDebuggerOnStart: false});
                } catch (e) {
                  console.error(e);
                }
                try {
                  await cmd("Debugger.disable");
                } catch (e) {
                  console.error(e);
                }
                try {
                  await dbg.detach(dbgTarget);
                } catch (e) {
                  console.error(e);
                }
                debugging.delete(dbgTarget.tabId);
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
