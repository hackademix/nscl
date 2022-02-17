/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2021 Giorgio Maone <https://maone.net>
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
(() => {
  let MOZILLA = "mozSystem" in XMLHttpRequest.prototype;
  let ENDPOINT_ORIGIN = "https://[ff00::]";
  let ENDPOINT_PREFIX = `${ENDPOINT_ORIGIN}/nscl/${browser.runtime.getURL("syncMessage")}?`;

  if (browser.webRequest) {
    if (typeof browser.runtime.onSyncMessage !== "object") {
      // Background Script side

      let pending = new Map();
      if (MOZILLA) {
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
      }

      let tabUrlCache = new Map();
      let asyncResults = new Map();
      let tabRemovalListener = null;
      let CANCEL = {cancel: true};
      let {TAB_ID_NONE} = browser.tabs;


      let onBeforeRequest = request => { try {
        let {url, tabId} = request;
        let params = new URLSearchParams(url.split("?")[1]);
        let msgId = params.get("id");
        if (asyncResults.has(msgId)) {
          return asyncRet(msgId);
        }
        let msg = params.get("msg");

        if (MOZILLA || tabId === TAB_ID_NONE) {
          // this shoud be a mozilla suspension request
          if (pending.has(msgId)) {
            let wrapper = pending.get(msgId);
            pending.delete(msgId);
            return (async () => {
              try {
                return ret({payload: (await wrapper.result)});
              } catch (e) {
                return ret({error: { message: e.message, stack: e.stack }});
              }
            })()
          }
          return CANCEL; // otherwise, bail
        }
        // CHROME from now on
        let documentUrl = request.initiator || params.get("url");
        let {frameAncestors, frameId} = request;
        let isTop = frameId === 0 || !!params.get("top");
        let tabUrl = frameAncestors && frameAncestors.length
          && frameAncestors[frameAncestors.length - 1].url;

        if (!tabUrl) {
          if (isTop) {
            tabUrlCache.set(tabId, tabUrl = documentUrl);
            if (!tabRemovalListener) {
              browser.tabs.onRemoved.addListener(tabRemovalListener = tab => {
                tabUrlCache.delete(tab.id);
              });
            }
          } else {
            tabUrl = tabUrlCache.get(tabId);
          }
        }
        let sender = {
          tab: {
            id: tabId,
            url: tabUrl
          },
          frameId,
          url: documentUrl,
          timeStamp: Date.now()
        };

        if (!(msg !== null && sender)) {
          return CANCEL;
        }
        let result = Promise.resolve(notifyListeners(msg, sender));
        // On Chromium, if the promise is not resolved yet,
        // we redirect the XHR to the same URL (hence same msgId)
        // while the result get cached for asynchronous retrieval
        result.then(r => storeAsyncRet(msgId, r));
        return asyncResults.has(msgId)
        ? asyncRet(msgId) // promise was already resolved
        : {redirectUrl: url.replace(
            /&redirects=(\d+)|$/, // redirects count to avoid loop detection
            (all, count) => `&redirects=${parseInt(count) + 1 || 1}`)};
      } catch(e) {
        console.error(e);
        return CANCEL;
      } };

      let onHeaderReceived = request => {
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
        return replaced ? {responseHeaders} : null;
      };

      let ret = r => ({redirectUrl:  `data:application/json,${encodeURIComponent(JSON.stringify(r))}`});

      let asyncRet = msgId => {
        let chunks = asyncResults.get(msgId);
        let chunk = chunks.shift();
        let more = chunks.length;
        if (more === 0) {
          asyncResults.delete(msgId);
        }
        return ret({chunk, more});
      };

      const CHUNK_SIZE = 500000; // Work around any browser-dependent URL limit
      let storeAsyncRet = (msgId, r) => {
        r = JSON.stringify(r);
        let len = r.length;
        let chunksCount = Math.ceil(len / CHUNK_SIZE);
        let chunks = [];
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
      browser.runtime.onSyncMessage = Object.freeze({
        ENDPOINT_PREFIX,
        addListener(l) {
          listeners.add(l);
          if (listeners.size === 1) {
            browser.webRequest.onBeforeRequest.addListener(onBeforeRequest,
              {
                urls: [`${ENDPOINT_PREFIX}*`],
                types: ["xmlhttprequest"]
              },
              ["blocking"]
            );
            browser.webRequest.onHeadersReceived.addListener(onHeaderReceived,
              {
                urls: ["<all_urls>"],
                types: ["main_frame", "sub_frame"]
              },
              ["blocking", "responseHeaders"]
            );
          }
        },
        removeListener(l) {
          listeners.remove(l);
          if (listeners.size === 0) {
            browser.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
            browser.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
          }
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
    let uuid = () => (Math.random() * Date.now()).toString(16);
    let docUrl = document.URL;
    browser.runtime.sendSyncMessage = (msg, callback) => {
      let msgId = `${uuid()},${docUrl}`;
      let url = `${ENDPOINT_PREFIX}id=${encodeURIComponent(msgId)}` +
        `&url=${encodeURIComponent(docUrl)}`;
      if (window.top === window) {
        // we add top URL information because Chromium doesn't know anything
        // about frameAncestors
        url += "&top=true";
      }

      if (MOZILLA) {
        // on Firefox we first need to send an async message telling the
        // background script about the tab ID, which does not get sent
        // with "privileged" XHR
        browser.runtime.sendMessage(
          {__syncMessage__: {id: msgId, payload: msg}}
        );
      }
      // then we send the payload using a privileged XHR, which is not subject
      // to CORS but unfortunately doesn't carry any tab id except on Chromium

      url += `&msg=${encodeURIComponent(JSON.stringify(msg))}`; // adding the payload
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
      if (callback) callback(result);
      return result;
    };
  }
})();
