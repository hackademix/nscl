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

// depends on /nscl/common/uuid.js

"use strict";
if (!["onSyncMessage", "sendSyncMessage"].some((m) => browser.runtime[m])) {
  const MOZILLA =
    self.XMLHttpRequest && "mozSystem" in self.XMLHttpRequest.prototype;

  const ENDPOINT_ORIGIN = "https://[ff00::]";
  const ENDPOINT_PREFIX = `${ENDPOINT_ORIGIN}/nscl/${browser.runtime.getURL(
    "syncMessage"
  )}?`;

  const msgUrl = (msgId) => `${ENDPOINT_PREFIX}id=${encodeURIComponent(msgId)}`;

  // https://github.com/w3c/webappsec-permissions-policy/blob/main/permissions-policy-explainer.md#appendix-big-changes-since-this-was-called-feature-policy
  const allowSyncXhr = (policy) =>
    policy
      .replace(/(?:[,;]\s*)?\b(?:sync-xhr\b[^;,]*)/gi, "")
      .replace(/^\s*[;,]\s*/, "");

  if (browser.webRequest) {
    // Background script / event page / service worker
    let anyMessageYet = false;
    // we don't care this is async, as long as it get called before the
    // sync XHR (we are not interested in the response on the content side)
    browser.runtime.onMessage.addListener((m, sender) => {
      let wrapper = m.__syncMessage__;
      if (!wrapper) return;
      if (wrapper.release) {
        suspender.release(wrapper.id);
      } else if ("payload" in wrapper) {
        anyMessageYet = true;
        wrapper.result = Promise.resolve(
          notifyListeners(JSON.stringify(wrapper.payload), sender)
        );
        suspender.hold(wrapper);
      }
      return Promise.resolve(null);
    });

    const asyncResults = new Map();

    const ret = (r) => ({
      redirectUrl: `data:application/json,${
        encodeURIComponent(JSON.stringify(r))}`,
    });
    const res = (payload) => ({ payload });
    const err = (e) => ({ error: { message: e.message, stack: e.stack } });

    const LOOP_RET = ret({ loop: 1 });

    const asyncRet = (msgId) => {
      let chunks = asyncResults.get(msgId);
      let chunk = chunks.shift();
      let more = chunks.length;
      if (more === 0) {
        asyncResults.delete(msgId);
        suspender.release(msgId);
      }
      return ret({ chunk, more });
    };

    const CHUNK_SIZE = 500000; // Work around any browser-dependent URL limit
    const storeAsyncRet = (msgId, r) => {
      r = JSON.stringify(r);
      const len = r === undefined ? 0 : r.length;
      const chunksCount = Math.ceil(len / CHUNK_SIZE);
      const chunks = [];
      for (let j = 0; j < chunksCount; j++) {
        chunks.push(r.substr(j * CHUNK_SIZE, CHUNK_SIZE));
      }
      asyncResults.set(msgId, chunks);
    };

    const listeners = new Set();
    function notifyListeners(msg, sender) {
      // Just like in the async runtime.sendMessage() API,
      // we process the listeners in order until we find a not undefined
      // result, then we return it (or undefined if none returns anything).
      for (let l of listeners) {
        try {
          let result = l(JSON.parse(msg), sender);
          if (result !== undefined) return result;
        } catch (e) {
          console.error("%o processing message %o from %o", e, msg, sender);
        }
      }
    }

    const suspender = (
      browser.declarativeNetRequest && !MOZILLA
        ? () => {
            // MV3
            const DNR_BASE_ID = 65535;
            const DNR_BASE_PRIORITY = 1000;
            let lastRuleId = DNR_BASE_ID;
            const msg2redirector = new Map();
            const { redirectUrl } = LOOP_RET;
            const resourceTypes = ["xmlhttprequest"];

            const createRedirector = async (
              urlFilter,
              redirectUrl,
              options
            ) => {
              const DEFAULT_OPTIONS = {
                priority: DNR_BASE_PRIORITY + 10,
                addRules: [],
                removeRuleIds: []
              }
              let { priority, addRules, removeRuleIds } = Object.assign(
                {},
                DEFAULT_OPTIONS,
                options
              );

              const rule = {
                id: ++lastRuleId,
                priority,
                action: {
                  type: "redirect",
                  redirect: { url: redirectUrl },
                },
                condition: {
                  urlFilter,
                  resourceTypes,
                },
              };

              console.debug("Creating rule ", rule); // DEV_ONLY

              addRules.push(rule);

              await browser.declarativeNetRequest.updateSessionRules({
                addRules,
                removeRuleIds,
              });

              return lastRuleId;
            };

            const removeRedirector = (redirId) => {
              browser.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [redirId],
              });
            };

            (async () => {
              try {
                const allowSyncXhrRules = [
                  "document-policy",
                  "feature-policy",
                ].map((header) => ({
                  id: ++lastRuleId,
                  priority: DNR_BASE_PRIORITY,
                  action: {
                    type: "modifyHeaders",
                    responseHeaders: [{ header, operation: "remove" }],
                  },
                  condition: {
                    responseHeaders: [{ header, values: ["*sync-xhr*"] }],
                    resourceTypes: ["main_frame", "sub_frame"],
                  },
                }));

                const oldRuleIds = (
                  await browser.declarativeNetRequest.getSessionRules()
                )
                  .map((r) => r.id)
                  .filter((id) => id >= DNR_BASE_ID);

                await createRedirector(
                  `|${ENDPOINT_PREFIX}*`,
                  redirectUrl,
                  {
                    priority: DNR_BASE_PRIORITY,
                    addRules: allowSyncXhrRules,
                    removeRuleIds: oldRuleIds,
                  }
                );
              } catch (e) {
                console.error(e);
              }
            })();

            return {
              async hold(wrapper) {
                let result;
                try {
                  result = ret(res(await wrapper.result));
                } catch (e) {
                  result = ret(err(e));
                }
                const { id } = wrapper;
                const urlFilter = `|${msgUrl(wrapper.id)}`;
                const redirId = await createRedirector(urlFilter, result.redirectUrl);
                msg2redirector.set(id, redirId);
              },
              release(id) {
                const redirId = msg2redirector.get(id);
                if (!redirId) return;
                msg2redirector.delete(id);
                removeRedirector(redirId);
              },
            };
          }
        : () => {
            // MV2
            const pending = new Map();
            const CANCEL = { cancel: true };
            const onBeforeRequest = (request) => {
              try {
                const { url } = request;
                const shortUrl = url.replace(ENDPOINT_PREFIX, "");
                const params = new URLSearchParams(url.split("?")[1]);
                const msgId = params.get("id");

                const chromeRet = (resultReady) => {
                  const r = resultReady
                    ? asyncRet(msgId) // promise was already resolved
                    : LOOP_RET;
                  console.debug("SyncMessage XHR->webRequest %s returning %o", shortUrl, r, request); // DEV_ONLY
                  return r;
                };

                if (asyncResults.has(msgId)) {
                  return chromeRet(true);
                }

                const wrapper = pending.get(msgId);

                console.debug(`PENDING ${shortUrl}: ${JSON.stringify(wrapper)}`, request); // DEV_ONLY
                if (!wrapper) {
                  return anyMessageYet
                    ? CANCEL // cannot reconcile with any pending message, abort
                    : LOOP_RET; // never received any message yet, retry
                }

                if (MOZILLA) {
                  // this should be a mozilla suspension request
                  return (async () => {
                    try {
                      return ret(res(await wrapper.result));
                    } catch (e) {
                      return ret(err(e));
                    } finally {
                      pending.delete(msgId);
                    }
                  })();
                }

                // CHROMIUM from now on
                // On Chromium, if the promise is not resolved yet,
                // we redirect the XHR to the same URL (hence same msgId)
                // while the result get cached for asynchronous retrieval
                wrapper.result.then(
                  (r) => storeAsyncRet(msgId, res(r)),
                  (e) => storeAsyncRet(msgId, err(e))
                );
                return chromeRet(asyncResults.has(msgId));
              } catch (e) {
                console.error(e);
                return CANCEL;
              }
            };

            const NOP = () => {};
            let bug1899786 = NOP;
            if (browser.webRequest.filterResponseData) {
              bug1899786 = (request) => {
                // work-around for https://bugzilla.mozilla.org/show_bug.cgi?id=1899786
                let compressed = false,
                  xml = false;
                for (const { name, value } of request.responseHeaders) {
                  switch (name.toLowerCase()) {
                    case "content-encoding":
                      if (
                        compressed ||
                        !(compressed =
                          /^(?:gzip|compress|deflate|br|zstd)$/i.test(value))
                      ) {
                        continue;
                      }
                      break;
                    case "content-type":
                      if (xml || !(xml = /\bxml\b/i.test(value))) {
                        continue;
                      }
                      break;
                    default:
                      continue;
                  }
                  if (compressed && xml) {
                    console.log("Applying mozbug 1899786 work-around", request);
                    const filter = browser.webRequest.filterResponseData(
                      request.requestId
                    );
                    filter.ondata = (e) => {
                      filter.write(e.data);
                    };
                    filter.onstop = () => {
                      filter.close();
                    };
                    break;
                  }
                }
              };
              (async () => {
                const version = parseInt(
                  (await browser.runtime.getBrowserInfo()).version
                );
                if (version < 126) bug1899786 = NOP;
              })();
            }

            const onHeadersReceived = (request) => {
              let replaced = false;
              let { responseHeaders } = request;
              let rxPolicy = /^(?:feature|permissions|document)-policy$/i;
              for (let h of request.responseHeaders) {
                if (rxPolicy.test(h.name)) {
                  const value = allowSyncXhr(h.value);
                  if (value !== h.value) {
                    replaced = true;
                    h.value = value;
                  }
                }
              }

              bug1899786(request);

              return replaced ? { responseHeaders } : null;
            };

            browser.webRequest.onBeforeRequest.addListener(
              onBeforeRequest,
              {
                urls: [`${ENDPOINT_PREFIX}*`],
                types: ["xmlhttprequest"],
              },
              ["blocking"]
            );
            browser.webRequest.onHeadersReceived.addListener(
              onHeadersReceived,
              {
                urls: ["<all_urls>"],
                types: ["main_frame", "sub_frame"],
              },
              ["blocking", "responseHeaders"]
            );

            return {
              hold(wrapper) {
                pending.set(wrapper.id, wrapper);
              },
              release(id) {
                pending.delete(id);
              },
            };
          }
    )();

    browser.runtime.onSyncMessage = Object.freeze({
      ENDPOINT_PREFIX,
      addListener(l) {
        listeners.add(l);
      },
      removeListener(l) {
        listeners.delete(l);
      },
      hasListener(l) {
        return listeners.has(l);
      },
      isMessageRequest(request) {
        return (
          request.type === "xmlhttprequest" &&
          request.url.startsWith(ENDPOINT_PREFIX)
        );
      },
    });
  } else {
    // Content Script side
    {
      // re-enable Sync XHR if disabled by featurePolicy
      const allow = f => {
        if (f.allow) {
          const allowingValue = allowSyncXhr(f.allow);
          if (f.allow != allowingValue) {
            f.allow = allowingValue;
            console.debug("Allowing Sync XHR on ", f, f.allow); // DEV_ONLY
            f.src = f.src;
          }
        }
      };
      try {
        // this is probably useless, but nontheless...
        window.frameElement && allow(window.frameElement);
      } catch (e) {
        // SOP violation?
        console.error(e); // DEV_ONLY
      }
      const mutationsCallback = records => {
        for (var r of records) {
          switch (r.type) {
            case "attributes":
              allow(r.target);
              break;
            case "childList":
              [...r.addedNodes].forEach(allow);
              break;
          }
        }
      };
      const observer = new MutationObserver(mutationsCallback);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributeFilter: ["allow"],
      });
    }

    const docId = uuid();
    browser.runtime.sendSyncMessage = (msg) => {
      let msgId = `${uuid()}:${docId}`;
      let url = msgUrl(msgId);

      // We first need to send an async message with both the payload
      // and "trusted" sender metadata, along with an unique msgId to
      // reconcile with in the retrieval phase via synchronous XHR
      browser.runtime.sendMessage({
        __syncMessage__: { id: msgId, payload: msg },
      });

      // Now go retrieve the result!
      const MAX_LOOPS = 1000;
      let r = new XMLHttpRequest();

      let result;
      let chunks = [];
      for (let loop = 0; ; ) {
        try {
          r.open("GET", url, false);
          r.send(null);
          result = JSON.parse(r.responseText);
          if ("chunk" in result) {
            let { chunk, more } = result;
            chunks.push(chunk);
            if (more) {
              continue;
            }
            result = JSON.parse(chunks.join(""));
          } else if (result.loop) {
            if (++loop > MAX_LOOPS) {
              console.debug(
                "Too many loops (%s), look for deadlock conditions.",
                loop
              );
              throw new Error("Too many SyncMessage loops!");
            }
            console.debug(`SyncMessage ${msgId} waiting for main process asynchronous processing, loop ${loop}/${MAX_LOOPS}.`); // DEV_ONLY
            continue;
          } else if (result.error) {
            result.error = new Error(result.error.message, result.error);
          }
        } catch (e) {
          console.error(e,
            `SyncMessage ${msgId} error in ${document.URL}: ${e.message} (response ${r.responseURL} ${r.responseText})`
          );
          result = {
            error: new Error(`SyncMessage Error ${e.message}`, { cause: e }),
          };
        }
        break;
      }
      browser.runtime.sendMessage({
        __syncMessage__: { id: msgId, release: true },
      });
      console.debug(`SyncMessage ${msgId}, state ${ document.readyState }, result: ${JSON.stringify(result)}`); // DEV_ONLY
      if (result.error) throw result.error;
      return result.payload;
    };
  }
}
