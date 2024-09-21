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

// depends on /nscl/common/uuid.js

"use strict";
(() => {
  let MOZILLA = self.XMLHttpRequest && "mozSystem" in self.XMLHttpRequest.prototype;
  let ENDPOINT_ORIGIN = "https://[ff00::]";
  let ENDPOINT_PREFIX = `${ENDPOINT_ORIGIN}/nscl/${browser.runtime.getURL("syncMessage")}?`;

  if (browser.webRequest) {
    if (typeof browser.runtime.onSyncMessage !== "object") {
      // Background Script side

      const pending = new Map();

      // we don't care this is async, as long as it get called before the
      // sync XHR (we are not interested in the response on the content side)
      browser.runtime.onMessage.addListener((m, sender) => {
        let wrapper = m.__syncMessage__;
        if (!wrapper) return;
        let {id} = wrapper;
        pending.set(id, wrapper);
        wrapper.result = Promise.resolve(notifyListeners(JSON.stringify(wrapper.payload), sender));
        return Promise.resolve(null);
      });

      const asyncResults = new Map();
      const CANCEL = {cancel: true};

      let onBeforeRequest = request => { try {
        let {url, tabId} = request;
        let params = new URLSearchParams(url.split("?")[1]);
        let msgId = params.get("id");

        if (asyncResults.has(msgId)) {
          return asyncRet(msgId);
        }

        console.debug(`PENDING ${msgId}: ${JSON.stringify(pending.get(msgId))}`); // DEV_ONLY
        if (!pending.has(msgId)) {
          return; // not a valid pending request, bail silently
        }

        const wrapper = pending.get(msgId);

        if (MOZILLA) {
          // this should be a mozilla suspension request
          pending.delete(msgId);
          return (async () => {
            try {
              return ret({payload: (await wrapper.result)});
            } catch (e) {
              return ret({error: { message: e.message, stack: e.stack }});
            }
          })()
        }

        // CHROMIUM from now on
        // On Chromium, if the promise is not resolved yet,
        // we redirect the XHR to the same URL (hence same msgId)
        // while the result get cached for asynchronous retrieval
        wrapper.result.then(r => storeAsyncRet(msgId, r));
        return asyncResults.has(msgId)
        ? asyncRet(msgId) // promise was already resolved
        : {redirectUrl: url.replace(
            /&redirects=(\d+)|$/, // redirects count to avoid loop detection
            (all, count) => `&redirects=${parseInt(count) + 1 || 1}`)};
      } catch(e) {
        console.error(e);
        return CANCEL;
      } };

      const NOP = () => {};
      let bug1899786 = NOP;
      if (browser.webRequest.filterResponseData) {
        bug1899786 = request => {
          // work-around for https://bugzilla.mozilla.org/show_bug.cgi?id=1899786
          let compressed = false, xml = false;
          for (const {name, value} of request.responseHeaders) {
            switch(name.toLowerCase()) {
              case "content-encoding":
                if (compressed || !(compressed =
                    /^(?:gzip|compress|deflate|br|zstd)$/i.test(value))) {
                  continue;
                }
                break;
              case "content-type":
                if (xml || !(xml =
                    /\bxml\b/i.test(value))) {
                  continue;
                }
                break;
              default:
                continue;
            }
            if (compressed && xml) {
              console.log("Applying mozbug 1899786 work-around", request);
              const filter = browser.webRequest.filterResponseData(request.requestId);
              filter.ondata = e => {
                filter.write(e.data);
              };
              filter.onstop = () => {
                filter.close();
              };
              break;
            }
          }
        }
        (async () => {
          const version = parseInt((await browser.runtime.getBrowserInfo()).version);
          if (version < 126) bug1899786 = NOP;
        })();
      }

      const onHeadersReceived = request => {
        let replaced = "";
        let {responseHeaders} = request;
        let rxFP = /^feature-policy$/i;
        for (let h of request.responseHeaders) {
          if (rxFP.test(h.name)) {
            h.value = h.value.replace(/\b(sync-xhr\s+)([^*][^;]*)/g,
              (all, m1, m2) => replaced =
                `${m1}${m2.replace(/'none'/, '')} 'self'`
            );
          }
        }

        bug1899786(request);

        return replaced ? {responseHeaders} : null;
      };

      let ret = r => ({redirectUrl:  `data:application/json,${encodeURIComponent(JSON.stringify(r))}`});

      let asyncRet = msgId => {
        let chunks = asyncResults.get(msgId);
        let chunk = chunks.shift();
        let more = chunks.length;
        if (more === 0) {
          asyncResults.delete(msgId);
          pending.delete(msgId);
        }
        return ret({chunk, more});
      };

      const CHUNK_SIZE = 500000; // Work around any browser-dependent URL limit
      let storeAsyncRet = (msgId, r) => {
        r = JSON.stringify(r);
        const len = r === undefined ? 0 : r.length;
        const chunksCount = Math.ceil(len / CHUNK_SIZE);
        const chunks = [];
        for (let j = 0; j < chunksCount; j++) {
          chunks.push(r.substr(j * CHUNK_SIZE, CHUNK_SIZE));
        }
        asyncResults.set(msgId, chunks);
      };

      let listeners = new Set();
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

      // We cannot configure these listeners lazily/dynamically anymore
      // because of the event pages / service workers stateless model.
      browser.webRequest.onBeforeRequest.addListener(onBeforeRequest,
        {
          urls: [`${ENDPOINT_PREFIX}*`],
          types: ["xmlhttprequest"]
        },
        ["blocking"]
      );
      browser.webRequest.onHeadersReceived.addListener(onHeadersReceived,
        {
          urls: ["<all_urls>"],
          types: ["main_frame", "sub_frame"]
        },
        ["blocking", "responseHeaders"]
      );

      browser.runtime.onSyncMessage = Object.freeze({
        ENDPOINT_PREFIX,
        addListener(l) {
          listeners.add(l);
        },
        removeListener(l) {
          listeners.remove(l);
        },
        hasListener(l) {
          return listeners.has(l);
        },
        isMessageRequest(request) {
          return request.type === "xmlhttprequest" && request.url.startsWith(ENDPOINT_PREFIX);
        }
      });
    }
  } else if (typeof browser.runtime.sendSyncMessage !== "function") {
    // Content Script side
    let docUrl = document.URL;
    browser.runtime.sendSyncMessage = (msg, callback) => {
      let msgId = `${uuid()},${docUrl}`;
      let url = `${ENDPOINT_PREFIX}id=${encodeURIComponent(msgId)}` +
        `&url=${encodeURIComponent(docUrl)}`;

      // We first need to send an async message with both the payload
      // and "trusted" sender metadata, along with an unique msgId to
      // reconcile with in the retrieval phase via synchronous XHR
      browser.runtime.sendMessage(
        {__syncMessage__: {id: msgId, payload: msg}}
      );

      // Now go retrieve the result!
      let r = new XMLHttpRequest();
      let result;
      let chunks = [];
      for (;;) {
        try {
          r.open("GET", url, false);
          r.send(null);
          result = JSON.parse(r.responseText);
          if ("chunk" in result) {
            let {chunk, more} = result;
            chunks.push(chunk);
            if (more) {
              continue;
            }
            result = JSON.parse(chunks.join(''));
          } else {
            if (result.error) throw result.error;
            result = "payload" in result ? result.payload : result;
          }
        } catch(e) {
          console.error(`syncMessage error in ${document.URL}: ${e.message} (response ${r.responseText})`);
        }
        break;
      }
      console.debug(`SyncMessage ${msgId}, state ${document.readyState}, result: ${JSON.stringify(result)}`); // DEV_ONLY
      if (callback) callback(result);
      return result;
    };
  }

})();
