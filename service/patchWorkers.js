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

  const updatePatch = (patch, tabId, documentUrl, url) => {
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
    return patchInfo;
  }


  const workerCreationListener = ({__patchWorkers__}, {tab, url: documentUrl}) => {
    if (!__patchWorkers__) return;
    try {
      const {url, patch, isServiceOrShared} = __patchWorkers__;
      const tabId = isServiceOrShared && !chrome.debugger ? -1 : tab.id;

      const patchInfo = updatePatch(patch, tabId, documentUrl, url);

      return init(tab.id, url, patchInfo);
    } catch (e) {
      console.error("Error on __patchWorkers__ message", e);
      return Promise.reject(e);
    }
  };

  browser.runtime.onMessage.addListener(workerCreationListener);

  let init = browser.webRequest.filterResponseData ? (() => {
    // Firefox

    // Filter the worker script sources from the network
    browser.webRequest.onBeforeSendHeaders.addListener(async request => {
      const { requestHeaders } = request;
      console.debug("patchesByTab", patchesByTab, request); // DEV_ONLY REMOVEME

      let type;
      for (const { name, value } of requestHeaders) {
        if (name == "Sec-Fetch-Dest") {
          if (!/work(er|let)/.test(value)) {
            return;
          }
          type = value;
          break;
        }
      }
      if (!type) {
        return;
      }

      const { tabId, frameId, url, documentUrl, originUrl, requestId  } = request;
      const byOrigin = patchesByTab.get(tabId);
      if (tabId == -1) {
        documentUrl = new URL(documentUrl).origin;
      }

      let patchInfo = byOrigin?.get(documentUrl);
      if (!patchInfo?.urls.has(url)) {
        // account for nested workers
        patchInfo = byOrigin.get(originUrl);
        if (!patchInfo) {
          if (tabId == -1) {
            return;
          }
          try {
            const patch = await browser.tabs.sendMessage(tabId,
              { __getWorkerPatch__: { url } },
              { frameId }
            );
            if (!patch) {
              return;
            }
          } catch(e) {
            return;
          }
          patchInfo = updatePatch(patch, tabId, documentUrl, url);
        }
        byOrigin.set(url, patchInfo);
        patchInfo.urls.add(url);
      }

      console.debug(`Patching ${type}`, requestId, url, documentUrl); // DEV_ONLY REMOVEME
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
    }, ["blocking", "requestHeaders"]);

    // attach the listener above just once per session
    return () => true;
  })() : async (...args) => {
    // Chromium

    // Section 1, run once per tab

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

      switch (method) {
        case "Network.requestWillBeSent":
          if (params.type == "Script" || params.type == "Other") {
            dbgInfo.requests.set(params.requestId, params.initiator.url);
            break;
          }
          return;
        case "Fetch.requestPaused":
          await dbgInfo.handleRequest(source, params);
          break;
        case "Network.loadingFinished":
        case "Network.loadingFailed":
          dbgInfo.requests.delete(params.requestId);
          return;
        default:
          return;
      }
      console.debug("Debugger event", method, params, source, dbgInfo.requests); // DEV_ONLY
    });

    dbg.onDetach.addListener((source, reason) => {
      console.debug("Detached debugger from", source, reason); // DEV_ONLY
      if (source.tabId) debugging.dispose(source.tabId);
    });

    // Section 2, run from now on

    const fetchParams = {
      patterns: [
        {
          resourceType: "Other",
          requestStage: "Response",
        },
      ]
    };

    return await (init = async (tabId, url, {patch}) => {
      const target = { tabId };
      let dbgInfo = await debugging.get(tabId);
      if (!dbgInfo) {
        const startingDebugger = (async () => {
          try {
            console.debug("Attaching debugger to", tabId); // DEV_ONLY
            try {
              await dbg.attach(target, "1.3");
            } catch (e) {
              // might just be because we're already attached
              console.error(e);
            }
            await dbg.sendCommand(target, "Fetch.enable", fetchParams);
            await dbg.sendCommand(target, "Network.enable");
          } catch (e) {
            console.error(e);
            throw e;
          }

          console.debug("NoScript's patchWorker started debugger on ", tabId);
          return {
            requests: new Map(),
            patches: new Map(),

            async handleRequest(source, params) {
              const { requestId, responseHeaders } = params;
              const contentTypeHeader = responseHeaders?.find(h => h.name.toLowerCase() === "content-type");
              const isJS = /\bjavascript\b/.test(contentTypeHeader?.value);
              if (isJS) {
                try {
                  const initiatorUrl = this.requests.get(params.networkId);
                  const codeChunks = [];
                  if (initiatorUrl) {
                    const { origin } = new URL(initiatorUrl);
                    if (this.patches.has(origin)) {
                      codeChunks.push(this.patches.get(origin).code);
                    }
                  }
                  const { origin } = new URL(params.request.url);
                  if (this.patches.has(origin)) {
                    codeChunks.push(this.patches.get(origin).code);
                  } else if (codeChunks[0]) {
                    // inherit patch from document
                    this.patch(origin, codeChunks[0]);
                  }
                  const code = [...new Set(codeChunks)].join(";");

                  if (code) {
                    const response = await dbg.sendCommand(source, "Fetch.getResponseBody", { requestId });
                    const body = code.concat(
                      response.base64Encoded ? atob(response.body) : response.body);
                    await dbg.sendCommand(source, "Fetch.fulfillRequest", {
                      requestId,
                      responseHeaders,
                      responsePhrase: params.responseStatusText,
                      responseCode: params.responseStatusCode,
                      body: btoa(unescape(encodeURIComponent(body)))
                    });
                    console.debug("Fetch: patched worker", params, { initiatorUrl, body }); // DEV_ONLY
                  }
                  return;
                } catch (e) {
                  console.error("Cannot patch worker via Fetch", e, params);
                }
              }
              console.debug("Fetch: continuing ", requestId);
              await dbg.sendCommand(source, "Fetch.continueRequest", { requestId });
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
            async dispose() {
              this.patches.clear();
              this.requests.clear();
              console.debug("Detaching debugger from tab", target.tabId); // DEV_ONLY
              try {
                await dbg.detach(target);
              } catch (e) {
                console.error(e);
              }
              debugging.delete(target.tabId);
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
