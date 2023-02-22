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

// depends on /nscl/lib/sha256.js
// depends on /nscl/common/uuid.js

"use strict";

var DocStartInjection = (() => {
  const MSG_ID = "__DocStartInjection__";
  let repeating = !("contentScripts" in browser);
  let scriptBuilders = new Set();
  let getId = ({requestId, tabId, frameId, url}) => requestId || `${tabId}:${frameId}:${url}`;
  let pending = new Map();

  function onMessage(msg, sender) {
    let payload = msg[MSG_ID];
    if (!payload) return;
    let {id, tabId, frameId, url} = payload;
    let ret = false;
    if (tabId === sender.tab.id && frameId === sender.frameId && url === sender.url) {
      end(payload, true);
      ret = true;
    }
    return Promise.resolve(ret);
  }

  async function begin(request) {
    let scripts = new Set();
    let {tabId, frameId, url} = request;
    if (tabId < 0 || !/^(?:(?:https?|ftp|data|blob|file):|about:blank$)/.test(url)) return;

    await Promise.all([...scriptBuilders].map(async buildScript => {
      try {
        let script = await buildScript({tabId, frameId, url});
        if (script) scripts.add(`try {
          ${typeof script === "function" ? `(${script})();` : script}
          } catch (e) {
            console.error("Error in DocStartInjection script", e);
          }`);
      } catch (e) {
        error("Error calling DocStartInjection scriptBuilder", buildScript, e);
      }
    }));

    if (scripts.size === 0) {
      debug(`DocStartInjection: no script to inject in ${url}`);
      return;
    }

    let id = getId(request);

    if (repeating) {
      let scriptsBlock = [...scripts].join("\n");
      let injectionId = `injection:${uuid()}:${sha256(scriptsBlock)}`;
      let args = {
        code: `(() => {
          let injectionId = ${JSON.stringify(injectionId)};
          if (document.readyState === "complete" ||
              window[injectionId] ||
              document.URL !== ${JSON.stringify(url)}
          ) return window[injectionId];
          window[injectionId] = true;
          ${scriptsBlock}
          return document.readyState === "loading";
        })();`,
        runAt: "document_start",
        frameId,
      };
      pending.set(id, args);
      await run(request, true);
    } else {
      let matches = [url];
      try {
        let urlObj = new URL(url);
        if (urlObj.port) {
          urlObj.port = "";
          matches[0] = urlObj.toString();
        }
      } catch (e) {}

      let ackMsg = JSON.stringify({
        [MSG_ID]: {id, tabId, frameId, url}
      });
      scripts.add(`if (document.readyState !== "complete") browser.runtime.sendMessage(${ackMsg});`);

      let options = {
        js: [...scripts].map(code => ({code})),
        runAt: "document_start",
        matchAboutBlank: true,
        matches,
        allFrames: true,
      };
      let current = pending.get(id);
      if (current) {
        current.unregister();
      }
      pending.set(id, await browser.contentScripts.register(options));
    }
  }

  async function run(request, repeat = false) {
    let id = getId(request);
    let args = pending.get(id);
    if (!args) return;
    let {url, tabId} = request;
    let attempts = 0, success = false;
    for (; pending.has(id);) {
      attempts++;
      try {
        if (attempts % 1000 === 0) {
          let tab = await browser.tabs.get(request.tabId);
          if (tab.url !== url) {
            console.error(`Tab mismatch: ${tab.url} <> ${url} (download-triggered?)`);
            break;
          }
          console.error(`DocStartInjection at ${url} ${attempts} failed attempts so far...`);
        }
        let ret = await browser.tabs.executeScript(tabId, args);
        if (success = ret[0]) {
          break;
        }
      } catch (e) {
        if (/No tab\b/.test(e.message)) {
          break;
        }
        if (!/\baccess\b/.test(e.message)) {
          console.error(e.message);
        }
        if (attempts % 1000 === 0) {
          console.error(`DocStartInjection at ${url} ${attempts} failed attempts`, e);
        }
      } finally {
        if (!repeat) break;
      }
    }
    pending.delete(id);
    debug(`DocStartInjection at ${url}, ${attempts} attempts, success = ${success}, repeat = ${repeat}.`);
  }

  function end(request, immediate = false) {
    let id = getId(request);
    let script = pending.get(id);
    if (script) {
      if (repeating) {
        run(request, false);
      } else {
        pending.delete(id);
        if (immediate) {
          script.unregister();
        } else {
          setTimeout(() => script.unregister(), 500);
        }
      }
    }
  }

  let listeners = {
    onBeforeNavigate: begin,
    onErrorOccurred: end,
    onCompleted: end,
  }

  function listen(enabled) {
    let {webNavigation, webRequest} = browser;
    let method = `${enabled ? "add" : "remove"}Listener`;
    let reqFilter =  {urls: ["<all_urls>"], types:  ["main_frame", "sub_frame", "object"]};
    function setup(api, eventName, listener, ...args) {
      let event = api[eventName];
      if (event) {
        event[method].apply(event, enabled ? [listener, ...args] : [listener]);
      }
    }
    if (repeating) {
      // Just Chromium
      setup(webRequest, "onResponseStarted", begin, reqFilter);
    } else {
      // add or remove Firefox's webNavigation listeners for non-http loads
      // and asynchronous blocking onHeadersReceived for registration on http
      let navFilter = enabled && {url: [{schemes: ["file", "ftp"]}]};
      for (let [eventName, listener] of Object.entries(listeners)) {
        setup(webNavigation, eventName, listener, navFilter)
      }
      setup(webRequest, "onHeadersReceived", begin, reqFilter, ["blocking"]);
      browser.runtime.onMessage[method](onMessage);
    }

    // add or remove common webRequest listener
    for (let [eventName, listener] of Object.entries(listeners)) {
       setup(webRequest, eventName, listener, reqFilter);
    }
  }

  return {
    register(scriptBuilder) {
      if (scriptBuilders.size === 0) listen(true);
      scriptBuilders.add(scriptBuilder);
    },
    unregister(scriptBuilder) {
      scriptBuilders.delete(scriptBuilder);
      if (scriptBuilders.size() === 0) listen(false);
    }
  };
})();