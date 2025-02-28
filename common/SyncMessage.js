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
// depends on /nscl/common/SyncMessage/request.json
// depends on /nscl/common/SyncMessage/response.json

"use strict";
if (!["onSyncMessage", "sendSyncMessage"].some((m) => browser.runtime[m])) {
  const MOZILLA =
    self.XMLHttpRequest && "mozSystem" in self.XMLHttpRequest.prototype;

  const INTERNAL_PATH = "/nscl/common/SyncMessage/";

  const MANIFEST = browser.runtime.getManifest();
  const USE_INTERNAL_URIS = MANIFEST.web_accessible_resources
    ?.some(({ resources }) =>
      resources.includes(`${INTERNAL_PATH}*`)
    );
  const IPV6_DUMMY_ENDPOINT = "https://[ff00::]";
  const BASE_PREFIX = browser.runtime.getURL(INTERNAL_PATH);
  // We cannot use BASE_PREFIX w/ internal URIs for requests (yet?) because
  // neither DNR nor webRequest nor ServiceWorker intercept our own extension URLs :(
  const REQUEST_PREFIX = `${IPV6_DUMMY_ENDPOINT}/${BASE_PREFIX}request.json?`;
  // But we can redirect to extension URLs on MV3
  const RESPONSE_PREFIX = USE_INTERNAL_URIS ? BASE_PREFIX + "response.json?" : "data:application/json,";

  const msgUrl = (msgId) => `${REQUEST_PREFIX}id=${encodeURIComponent(msgId)}`;

  // https://github.com/w3c/webappsec-permissions-policy/blob/main/permissions-policy-explainer.md#appendix-big-changes-since-this-was-called-feature-policy
  const allowSyncXhr = (policy) =>
    policy
      .replace(/(?:[,;]\s*)?\b(?:sync-xhr\b[^;,]*)/gi, "")
      .replace(/^\s*[;,]\s*/, "");

  if (browser.webRequest) {
    // Background script / event page / service worker

    const USE_SERVICE_WORKER = "onfetch" in self && REQUEST_PREFIX.startsWith(BASE_PREFIX);

    let anyMessageYet = false;

    const retries = new Set();

    // we don't care this is async, as long as it get called before the
    // sync XHR (we are not interested in the response on the content side)
    browser.runtime.onMessage.addListener((m, sender) => {
      let wrapper = m.__syncMessage__;
      if (!wrapper) return;
      if(wrapper.retry) {
        const retryKey = `${sender.tab.id}:${sender.frameId}:${sender.origin}@${sender.url}`;
        let retried = retries.has(retryKey);
        if (retried) {
          retries.delete(retryKey);
        } else {
          retries.add(retryKey);
        }
        console.debug(`SyncMessage retry ${retried ? "(giving up)" : "now" }.`, retryKey); // DEV_ONLY
        return Promise.resolve(!retried);
      }
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
      redirectUrl: `${
        RESPONSE_PREFIX
        }${
        encodeURIComponent(JSON.stringify(r))
        }`,
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

    const url2MsgId = url => new URLSearchParams(url.split("?")[1])?.get("id");
    class Suspender {
      #pending = new Map();
      constructor(init) {
        init.apply(this);
      }
      async hold(wrapper) {
        this.#pending.set(wrapper.id, wrapper);
      }
      release(id) {
        this.#pending.delete(id);
      }
      get(id) {
        return this.#pending.get(id);
      }
    }

    const suspender =
      USE_SERVICE_WORKER
      ? new Suspender(function() {
        // MV3 with service worker
        console.debug("Registering sw fetch listener"); // DEV_ONLY
        addEventListener("fetch", event => {
          console.debug("Extension sw fetch event", event); // DEV_ONLY
          const msgId = url2MsgId(event.request.url);
          if (!msgId) return;
          const wrapper = this.get(msgId);
          this.release(msgId);
          event.respondWith((async () => new Response(await wrapper.result))());
        });
      })
      : browser.declarativeNetRequest && !MOZILLA
        ? (() => {
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
                ruleSet: "Session",
                priority: DNR_BASE_PRIORITY + 10,
                addRules: [],
                removeRuleIds: []
              }
              let { ruleSet, priority, addRules, removeRuleIds } = Object.assign(
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
              const method = `update${ruleSet}Rules`;
              await browser.declarativeNetRequest[method]({
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
              const allowSyncXhrRules = [
                {
                  id: ++lastRuleId,
                  priority: DNR_BASE_PRIORITY,
                  action: {
                    type: "modifyHeaders",
                    // Note: notwithstanding poor documentation, looks like in modern browsers
                    // permissions-policy overrides (document|feature)-policy, & DNR appending
                    // to the header overrides the restrictive token despite inheritance rules,
                    // making the following hack work, quite surprisingly and nicely (i.e.
                    // other policies, if present, remain effective).
                    responseHeaders: [
                      {
                        header: "permissions-policy",
                        operation: "append",
                        value: "sync-xhr=*",
                      },
                    ],
                  },
                  condition: {
                    resourceTypes: ["main_frame", "sub_frame"],
                  },
                },
              ];

              for (const ruleSet of ["Dynamic", "Session"]) {
                try {
                  const removeRuleIds = (
                    await browser.declarativeNetRequest[`get${ruleSet}Rules`]()
                  )
                    .map((r) => r.id)
                    .filter((id) => id >= DNR_BASE_ID);
                  const options = {
                    ruleSet,
                    priority: DNR_BASE_PRIORITY,
                    addRules: allowSyncXhrRules,
                    removeRuleIds,
                  };
                  await createRedirector(
                    `|${REQUEST_PREFIX}*`,
                    redirectUrl,
                    options
                  );
                } catch (e) {
                  console.error(e, "Error initializing SyncMessage DNR responders.");
                }
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
          })()
        : new Suspender(function() {
            // MV2
            const CANCEL = { cancel: true };
            const onBeforeRequest = (request) => {
              try {
                const { url } = request;
                const shortUrl = url.replace(REQUEST_PREFIX, "");
                const msgId = url2MsgId(url);

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

                const wrapper = this.get(msgId);

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
                      this.release(msgId);
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

            const patchHeadersForXhr = MANIFEST.manifest_version < 3
            ? NOP // XHR don't need to bypass CSP in manifest V2
            : (request) => {
                let replaced = false;
                let replacedCSP = false;
                const { responseHeaders } = request;
                const CSP = "content-security-policy";
                const rxPolicy = /^(?:feature|permissions|document)-policy$/;
                for (let h of responseHeaders) {
                  const name = h.name.toLowerCase();
                  let value;
                  if (rxPolicy.test(name)) {
                    value = allowSyncXhr(h.value);
                  } else if (name == CSP) {
                    value = h.value.replace(/connect-src [^;]+/g, m => {
                      const tokens = new Set(m.split(/\s+/));
                      tokens.delete("'none'");
                      const msgSrc = new URL(REQUEST_PREFIX).origin;
                      tokens.has(msgSrc) || tokens.add(msgSrc);
                      return [...tokens].join(" ");
                    });
                    replacedCSP = true;
                  } else {
                    continue;
                  }
                  if (value !== h.value) {
                    h.value = value;
                    replaced = true;
                  }
                }
                if (replaced) {
                  console.log("Patched responseHeaders", request.url, responseHeaders); // DEV_ONLY
                  if (replacedCSP) {
                    // We need to clear the header first, in order to avoid merging, see
                    // - https://searchfox.org/mozilla-central/source/toolkit/components/extensions/webrequest/WebRequest.sys.mjs#257
                    // - https://bugzilla.mozilla.org/show_bug.cgi?id=1462989
                    // This does NOT work (yet?) on MV3, see https://github.com/w3c/webextensions/issues/730
                    responseHeaders.unshift({name: CSP, value: ""});
                  }
                  return { responseHeaders };
                }
              };

            const onHeadersReceived = (request) => {
              bug1899786(request);
              return patchHeadersForXhr(request);
            };

            browser.webRequest.onBeforeRequest.addListener(
              onBeforeRequest,
              {
                urls: [`${REQUEST_PREFIX}*`],
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


          }
        );

    console.debug("Using suspender", suspender, USE_SERVICE_WORKER); // DEV_ONLY

    browser.runtime.onSyncMessage = Object.freeze({
      BASE_PREFIX,
      REQUEST_PREFIX,
      RESPONSE_PREFIX,
      addListener(l) {
        listeners.add(l);
      },
      removeListener(l) {
        listeners.delete(l);
      },
      hasListener(l) {
        return listeners.has(l);
      },
      isMessageRequest({type, url}) {
        return (
          type === "xmlhttprequest" &&
          url.includes(INTERNAL_PATH) &&
          (url.includes(REQUEST_PREFIX) || url.includes(RESPONSE_PREFIX))
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

      const preSend = __syncMessage__ => browser.runtime.sendMessage({__syncMessage__});

      // We first need to send an async message with both the payload
      // and "trusted" sender metadata, along with an unique msgId to
      // reconcile with in the retrieval phase via synchronous XHR
      const preflight = preSend({ id: msgId, payload: msg });

      // Now go retrieve the result!
      const MAX_LOOPS = 1000;
      let r = new XMLHttpRequest();

      let result;
      let chunks = [];
      for (let loop = 0; ; ) {
        try {
          r.open("GET", url, false);
          r.send(null);
          const rawResult = r.responseURL.startsWith(RESPONSE_PREFIX)
            ? decodeURIComponent(r.responseURL.replace(RESPONSE_PREFIX, ""))
            : r.responseText;
          result = JSON.parse(rawResult);
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
            result.error = new Error(result.error.message + ` (${url})`, result.error);
          }
        } catch (e) {
          console.error(e,
            `SyncMessage ${msgId} error in ${document.URL}: ${e.message} (response ${url} - ${r.responseURL} - ${r.responseText})`
          );
          result = {
            error: new Error(`SyncMessage Error ${e.message}`, { cause: e }),
          };
        }
        break;
      }
      preSend({ id: msgId, release: true });
      console.debug(`SyncMessage ${msgId}, state ${ document.readyState }, result: ${JSON.stringify(result)}`); // DEV_ONLY
      if (result.error) {
        if (document.featurePolicy && !document.featurePolicy?.allowsFeature("sync-xhr")) {
          throw new Error(`SyncMessage fails on ${document.URL} because sync-xhr is not allowed!`);
        }
        if (document.readyState == "loading" && /Failed to load/.test(result.error.message)) {
          window.stop();
          (async () => {
            try {
              await preflight;
              browser.runtime.sendSyncMessage(msg);
            } catch (e) {
              console.error(e, `SyncMessage immediate retry failed on ${document.URL}!`);
              if (!(await preSend({retry: true}))) {
                return;
              }
            }
            history.go(0);
          })();
        }
        throw result.error;
      }
      return result.payload;
    };
  }
}
