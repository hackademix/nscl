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

  const INIT_EVENT = JSON.stringify(`workerPatch:${uuid()}`);
  const wrapPatch = patch => `(() => {
    if (globalThis.dispatchEvent) {
      if (!dispatchEvent(new CustomEvent(${INIT_EVENT}, { cancelable: true }))) {
        console.debug("Worker already patched, not at the top level?", globalThis.location?.href); // DEV_ONLY
        return;
      }
      addEventListener(${INIT_EVENT}, e => e.preventDefault(), true);
    }
    ${patch}
  })();
  `;

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
      patch = wrapPatch(patch);
      let patchInfo = byOrigin.get(documentUrl);
      if (!patchInfo) byOrigin.set(documentUrl, patchInfo = {
        patch,
        urls: new Set(),
      });
      else {
        patchInfo.patch = patch;
      }
      patchInfo.urls.add(url);
      // account for nested workers
      byOrigin.set(url, patchInfo);

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
      let {tabId, url, documentUrl, originUrl, requestId} = request;
      console.debug("patchesByTab", patchesByTab, request); // DEV_ONLY REMOVEME
      let byOrigin = patchesByTab.get(tabId);
      if (!byOrigin) return;
      if (tabId == -1) {
        documentUrl = new URL(documentUrl).origin;
      }
      let patchInfo = byOrigin.get(documentUrl);
      if (!patchInfo?.urls.has(url)) {
        // account for nested workers
        patchInfo = byOrigin.get(originUrl);
        if (!patchInfo) {
          return;
        }
        byOrigin.set(url, patchInfo);
        patchInfo.urls.add(url);
      }

      console.debug(`Patching ${tabId == -1 ? 'service' : ''}worker`, requestId, url, documentUrl); // DEV_ONLY REMOVEME
      let filter = browser.webRequest.filterResponseData(requestId);
      filter.onstart = () => {
        console.debug("filter.onstart", requestId, patchInfo.patch);  // DEV_ONLY REMOVEME
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

    const dbg = chrome.debugger;

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

    dbg.onEvent.addListener(async (source, method, params) => {
      let { tabId } = source;
      const dbgInfo = await debugging.get(tabId);
      if (!dbgInfo) {
        return;
      }
      if (/^(?:Debugger.script|Runtime\.console)/.test(method)) return; // DEV_ONLY
      console.debug("Debugger event", method, params, source); // DEV_ONLY
      switch (method) {
        case "Fetch.requestPaused":
          await dbgInfo.handleRequest(source, params);
          break;
        case "Target.attachedToTarget":
          await dbgInfo.handleTarget(source, params);
          break;
        case "Runtime.executionContextCreated":
          await dbgInfo.handleExecutionContext(source, params);
          break;
        case "Runtime.executionContextDestroyed":
          await dbgInfo.dispose({ uniqueId: params.executionContextUniqueId });
          break;
      }

    });

    dbg.onDetach.addListener((source, reason) => {
      console.debug("Detached debugger from", source, reason); // DEV_ONLY
      if (source.tabId) debugging.dispose(source.tabId);
    });

    // Section 2, run from now on

    // see https://chromedevtools.github.io/devtools-protocol/tot/Target/#type-TargetFilter
    // and https://source.chromium.org/chromium/chromium/src/+/main:content/browser/devtools/devtools_agent_host_impl.cc?ss=chromium&q=f:devtools%20-f:out%20%22::kTypeTab%5B%5D%22
    const targetFilter = ["worker", "shared_worker", "service_worker", "worklet", "shared_storage_worklet", "auction_worklet"]
          .map(type => ({ type, exclude: false }));
    const attachParams = {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      targetFilter,
    };
    const fetchParams = {
      patterns: [
        {
          resourceType: "Script",
          requestStage: "Response",
        },
        {
          resourceType: "Other",
          requestStage: "Response",
        },
      ]
    };

    return await (init = async (tabId, url, {patch}) => {
      const dbgTarget = { tabId };
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
            await cmd("Target.setAutoAttach", attachParams);
            await cmd("Fetch.enable", fetchParams);
          } catch (e) {
            console.error(e);
            throw e;
          }

          console.debug("NoScript's patchWorker started debugger on ", tabId);
          return {
            contexts: new Set(),
            patches: new Map(),

            async handleRequest(source, params) {
              const { requestId, responseHeaders, resourceType } = params;
              const contentTypeHeader = responseHeaders?.find(h => h.name.toLowerCase() === "content-type");
              const isJS = /\bjavascript\b/.test(contentTypeHeader?.value);
              if (isJS) {
                try {
                  const { origin } = new URL(params.request.url);
                  if (this.patches.has(origin)) {
                    const response = await dbg.sendCommand(source, "Fetch.getResponseBody", { requestId });
                    const body = this.patches.get(origin).code.concat(
                      response.base64Encoded ? atob(response.body) : response.body);
                    await dbg.sendCommand(source, "Fetch.fulfillRequest", {
                      requestId,
                      responseHeaders,
                      responsePhrase: params.responseStatusText,
                      responseCode: params.responseStatusCode,
                      body: btoa(unescape(encodeURIComponent(body)))
                    });
                    console.debug("Fetch: patched worker", params, body); // DEV_ONLY
                  }
                  return;
                } catch (e) {
                  console.error("Cannot patch worker via Fetch", e, params);
                }
              }
              console.debug("Fetch: continuing ", requestId, resourceType);
              await dbg.sendCommand(source, "Fetch.continueRequest", { requestId });
            },

            async handleTarget(source, { sessionId, targetInfo }) {
              const {url, type} = targetInfo;

              const session = {...source, sessionId};
              try {
                const { origin } = new URL(url);
                console.debug("Examining TargetInfo", type, targetInfo, this.patches.has(origin)); // DEV_ONLY
                if (!(this.patches.has(origin) && /work(er|let)$/.test(type))) {
                  return;
                }
                console.debug("Session %s (%s, %s), attaching debugger to patch workers.", sessionId, url, origin); // DEV_ONLY
                if (!/worklet/.test(type)) {
                  await dbg.sendCommand(session, "Target.setAutoAttach", attachParams).catch(e => {
                    console.error("Attaching child workers failed", session, targetInfo, e);
                  });
                  // await dbg.sendCommand(session, "Fetch.enable", fetchParams);
                }
                // await dbg.sendCommand(session, "Runtime.enable");
                return;
                const expression = this.patches.get(origin)?.code;
                console.debug("Patching worker", url, this.patches, source); // DEV_ONLY
                await dbg.sendCommand(session, "Page.addScriptToEvaluateOnNewDocument", {
                  source: expression,
                  runImmediately: true,
                });

              } catch (e) {
                console.error("Attaching failed", e, targetInfo, session);
              } finally {
                await dbg.sendCommand(source, "Runtime.runIfWaitingForDebugger");
              }
            },

            async handleExecutionContext(source, { context }) {
              try {
                const { origin } = new URL(context.origin);
                const { uniqueId } = context;
                const expression = this.patches.get(origin)?.code;
                console.debug("Patching worker", context.origin, this.patches, context, source); // DEV_ONLY
                dbg.sendCommand(source, "Runtime.runIfWaitingForDebugger");
                if (expression) {
                  await dbg.sendCommand(source, "Runtime.evaluate", {
                    expression,
                    silent: true,
                    // uniqueContextId: uniqueId,
                    contextId: context.id,
                    allowUnsafeEvalBlockedByCSP: true,
                  });
                } else {
                  console.warn("No worker patch find for origin", origin);
                }
                this.contexts.add(uniqueId);
              } catch (e) {
                console.error("Runtime.evaluate failed", e, source, context);
              } finally {
                //await dbg.sendCommand(source, "Runtime.runIfWaitingForDebugger");
              }
            },

            patch(origin, code) {
              let patch = this.patches.get(origin);
              if (!patch) {
                this.patches.set(origin, patch = { origin, code, count: 1 });
              } else {
                patch.code = code;
                patch.count++;
              }
            },
            async dispose(executionContext) {
              console.debug("Disposing", executionContext?.uniqueId); // DEV_ONLY
              if (!executionContext) {
                this.patches.clear();
                this.contexts.clear();
              } else {
                if (this.contexts.has(executionContext.uniqueId)) {
                  this.contexts.delete(executionContext.uniqueId);
                  if (this.contexts.size == 0) {
                    this.patches.clear();
                  }
                }
              }
              if (this.patches.size === 0 && this.contexts.size == 0) {
                console.debug("Detaching debugger from tab", dbgTarget.tabId); // DEV_ONLY
                try {
                  await cmd("Target.setAutoAttach", {autoAttach: false, waitForDebuggerOnStart: false});
                } catch (e) {
                  console.error(e);
                }
                try {
                  await dbg.detach(dbgTarget);
                } catch (e) {
                  console.error(e);
                }

                try {
                  await cmd("Debugger.disable");
                } catch (e) {
                   console.error(e); // DEV_ONLY
                }
                debugging.delete(dbgTarget.tabId);
              }
            }
          }
        })();
        debugging.set(tabId, startingDebugger);
        dbgInfo = await startingDebugger;
      }
      dbgInfo.patch(new URL(url).origin, patch);
    })(...args);
  };
}
