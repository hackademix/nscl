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
      if (globalThis.FetchEvent) {
        addEventListener("fetch", e => {
          if (e.isTrusted && navigator.onLine &&
              /work(?:er|let)$/.test(e.request.destination)) {
            e.stopImmediatePropagation();
          }
        }, true);
      }
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

  const updatePatch = (patch, tabId, origin, url) => {
    let byOrigin = patchesByTab.get(tabId);
    if (!byOrigin) patchesByTab.set(tabId, byOrigin = new Map());
    origin = new URL(origin).origin;
    patch = wrapPatch(patch);
    let patchInfo = byOrigin.get(origin);
    if (!patchInfo) byOrigin.set(origin, patchInfo = {
      patch,
      destinations: new Set(),
    });
    else {
      patchInfo.patch = patch;
    }
    const destination = new URL(url).origin;
    patchInfo.destinations.add(destination);
    // account for nested workers
    byOrigin.set(destination, patchInfo);
    return patchInfo;
  };

  const parseRequestHeaders = headers => {
    // force lowercase names both in WebExtensions and CDP format
    headers = Object.fromEntries(
      (Array.isArray(headers)
        ? headers.map(o => [o.name, o.value])
        : Object.entries(headers)
      ).map(([name, value]) => [name.toLowerCase(), value])
    );
    const type = headers["sec-fetch-dest"];
    if (!(type && /work(er|let)/.test(type))) {
      return;
    }
    const mode = headers["sec-fetch-mode"];
    return {
      type,
      isModule: mode == "cors" || type.includes("worklet"),
    };
  };

  const findStaticImportScheme = async (source) => {
    await include("/nscl/lib/acorn.js");

    let scheme = null;
    let ast;
    try {
      ast = acorn.parse(source, {
        ecmaVersion: "latest",
        sourceType: "module"
      });
    } catch (e) {
      // Default to blob if the source cannot be parsed
      return "blob";
    }

    for (const node of ast.body) {
      switch (node.type) {
        case "ImportDeclaration":
        case "ExportNamedDeclaration":
        case "ExportAllDeclaration":
          break;
        default:
          continue;
      }

      const specifier = node.source?.value;
      if (!specifier) continue;
      try {
        const s = new URL(specifier).protocol.slice(0, -1);
        if (s == "blob" || s == "data") {
          scheme = s;
        }
      } catch (e) {
        continue;
      }
      if (scheme == "data") {
        break;
      }
    }

    return scheme;
  }

  const mergePatch = async (patch, body, { tabId, origin, isModule }) => {
    if (isModule && /\b(?:im|ex)port\b/.test(body)) {
      const scheme = globalThis.PATCHWORKERS_DEBUG_SCHEME || await findStaticImportScheme(body);
      switch (scheme) {
        case "blob":
          try {
            const blobUrl = await browser.tabs.sendMessage(tabId,
              {
                __getWorkerPatch__: {
                  origin,
                  asBlobUrl: true,
                  patch
                },
              },
            );
            if (blobUrl) {
              patch = `import "${blobUrl}";`;
              break;
            }
          } catch (e) {
            console.error(e);
          }
          // fallback to data: if blobUrl can't be created for this origin
        case "data":
          patch = `import "data:text/javascript,${encodeURIComponent(patch)};";`;
        break;
      }
    }
    return patch.concat(body);
  }

  const workerCreationListener =({__patchWorkers__}, sender) => {
    if (!__patchWorkers__) return;
    const { tab, frameId, url: documentUrl } = sender;
    try {
      const {url, patch, isServiceOrShared} = __patchWorkers__;
      const tabId = isServiceOrShared && !chrome.debugger ? -1 : tab.id;

      const patchInfo = updatePatch(patch, tabId, documentUrl, url);

      return Promise.resolve(init(tab.id, frameId, url, patchInfo)).then(r => "ready");
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
      const workerInfo = parseRequestHeaders(request.requestHeaders);
      if (!workerInfo) {
        return;
      }
      const { type, isModule } = workerInfo;
      const { tabId, frameId, url, documentUrl, originUrl, requestId } = request;
      const byOrigin = patchesByTab.get(tabId);
      const documentOrigin = new URL(documentUrl).origin;
      const initiatorOrigin = new URL(originUrl).origin;

      let patchInfo = byOrigin?.get(documentOrigin);
      if (!patchInfo) {
        // account for nested workers
        patchInfo = byOrigin?.get(initiatorOrigin);
        if (!patchInfo) {
          if (tabId == -1) {
            // we don't have any document to get the patch from
            return;
          }
          try {
            const patch = await browser.tabs.sendMessage(tabId,
              { __getWorkerPatch__: {} },
              { frameId }
            );
            if (!patch) {
              return;
            }
          } catch (e) {
            return;
          }
          patchInfo = updatePatch(patch, tabId, documentOrigin, url);
        } else {
          updatePatch(patchInfo.patch, tabId, documentOrigin, url);
        }
      }

      console.debug(`Patching ${type}`, requestId, url, documentUrl); // DEV_ONLY REMOVEME
      const filter = browser.webRequest.filterResponseData(requestId);
      const chunks = [];
      Object.assign(filter,
        isModule ? // we need to buffer and check static imports
        {
          ondata({ data }) {
            chunks.push(data);
          },
          async onstop() {
            try {
              const size = chunks.reduce((n, chunk) => n + chunk.byteLength, 0);
              const sourceBytes = new Uint8Array(size);
              let offset = 0;

              for (const chunk of chunks) {
                sourceBytes.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
              }

              const origin = new URL(url).origin;
              const body = await mergePatch(patchInfo.patch,
                new TextDecoder().decode(sourceBytes),
                { tabId, origin, isModule, }
              );
              filter.write(new TextEncoder().encode(body));
            } catch (e) {
              console.error("Cannot patch worker response, failing close", e);
              filter.disconnect();
            } finally {
              filter.close();
            }
          }
        }
        : // classic worker, don't buffer - we just need to prepend the self-contained patch code
        {
          onstart() {
            console.debug("filter.onstart", requestId, patchInfo.patch);  // DEV_ONLY REMOVEME
            filter.write(new TextEncoder().encode(patchInfo.patch));
          },
          ondata(e) {
            filter.write(e.data);
          },
          onstop(e) {
            filter.close();
          }
        }
      );
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

    const fetchParams = {
      patterns:
        ["Other", "Script"].flatMap(resourceType =>
          ["Request", "Response"].map(requestStage => ({ resourceType, requestStage }))
        )
    };


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
        case "Target.attachedToTarget":
          if (dbgInfo.notifyFrameAttached) {
            dbgInfo.notifyFrameAttached();
            delete dbgInfo.notifyFrameAttached;
          }
          const target = { tabId: source.tabId, sessionId: params.sessionId };
          await dbg.sendCommand(target, "Fetch.enable", fetchParams);
          await dbg.sendCommand(target, "Network.enable");
          await dbg.sendCommand(target, "Runtime.runIfWaitingForDebugger");
        break;
        case "Network.requestWillBeSent":
          if (params.type == "Script" || params.type == "Other") {
            dbgInfo.requests.set(params.requestId, params.initiator.url);
            break;
          }
          return;
        case "Network.requestWillBeSentExtraInfo":
          const initiatorUrl = dbgInfo.requests.get(params.requestId);
          if (!initiatorUrl) {
            break;
          }
          const workerInfo = parseRequestHeaders(params.headers);
          if (!workerInfo) {
            dbgInfo.requests.delete(params.requestId);
          } else {
            workerInfo.initiatorUrl = initiatorUrl;
            dbgInfo.requests.set(params.requestId, workerInfo);
          }
          break;
        case "Fetch.requestPaused":
          dbgInfo.handleRequest(source, params);
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

    return await (init = async (tabId, frameId, url, { patch }) => {
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
            await dbg.sendCommand(target, "Target.setAutoAttach", {
              autoAttach: true,
              waitForDebuggerOnStart: true,
              flatten: true,
              filter: [
                { type: "iframe", exclude: false }
              ],
            });
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
              const isJS = /\bjavascript\b/i.test(contentTypeHeader?.value);
              if (isJS && this.requests.has(params.networkId)) {
                try {
                  const { type, isModule, initiatorUrl } = this.requests.get(params.networkId);
                  if (!type) throw new Error(`Cannot guess worklet type for ${params.request.url}`);
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
                    let body = response.base64Encoded ? atob(response.body) : response.body;
                    body = await mergePatch(code, body, { tabId: source.tabId, origin, isModule });
                    body = btoa(unescape(encodeURIComponent(body)));
                    await dbg.sendCommand(source, "Fetch.fulfillRequest", {
                      requestId,
                      responseHeaders,
                      responsePhrase: params.responseStatusText,
                      responseCode: params.responseStatusCode,
                      body,
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
              console.debug("Debugger detached from tab", target.tabId); // DEV_ONLY
              debugging.delete(target.tabId);
            }
          }
        })();
        debugging.set(tabId, startingDebugger);
        try {
          dbgInfo = await startingDebugger;
        } catch (e) {
          console.error(e);
          throw e;
        }
        try {
          if (frameId > 0) {
            await new Promise(resolve => {
              dbgInfo.notifyFrameAttached = resolve;
              setTimeout(resolve, 200);
            });
          }
        } catch (e) {
          console.error(e);
        }
      }
      dbgInfo.patch(new URL(url).origin, patch);
    })(...args);
  };
}
