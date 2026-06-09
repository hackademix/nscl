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

// depends on /nscl/common/sha256.js
// depends on /nscl/common/uuid.js

"use strict";

var DocStartInjection = (() => {
  const MSG_ID = "__DocStartInjection__";
  const isGecko = "contentScripts" in browser;
  const mv3Callbacks = !browser.tabs.executeScript; // mv3 on Chrome
  const isMv3Callback = script => typeof script == "object" && ("data" in script || "callback" in script || "assign" in script);

  let scriptBuilders = new Set();
  let getId = ({requestId, tabId, frameId, url}) => requestId || `${tabId}:${frameId}:${url}`;
  let pending = new Map();

  async function begin(request) {
    let scripts = new Set();
    let {tabId, frameId, cookieStoreId, url, type, documentId, documentLifecycle, frameType} = request;

    if (tabId < 0 || !/^(?:(?:https?|ftp|data|blob|file):|about:blank$)/.test(url)) return;

    if (!type && frameId == 0) {
      type = "main_frame"; // Gecko uses webNavigation.onBeforeNavigate, no request type
    }
    if (documentLifecycle == "prerender" && frameType == "outmostframe") {
      debug("Prerendering top frame", tabId, frameId, url); // DEV_ONLY
    }
    await Promise.allSettled([...scriptBuilders].map(async buildScript => {
      let script;
      try {
        script = await buildScript({tabId, frameId, cookieStoreId, url, type});
        if (!script) return;
        if (mv3Callbacks) {
          if (!isMv3Callback(script)) {
            throw new Error('On MV3 only {data: jsonObject, callback: "globalFunctionName", assign: "globalScopeVarName"} injection can work!')
          }
          const {data, callback, assign} = script;
          scripts.add({
            data,
            callback,
            assign,
          });
          return;
        }

        // mv2
        if (isMv3Callback(script)) {
          // convert mv3-style callback to mv2
          script = `
            const {data, callback, assign} = ${JSON.stringify(script)};
            if (assign && !(assign in globalThis)) {
              globalThis[assign] = data;
            }
            if (callback) {
              let cb = globalThis[callback];
              if (typeof cb == "function") {
                cb.call(globalThis, data);
              } else {
                console.warn(\`callback globalThis.${script.callback} is not a function.\`);
              }
            }
         `;
        }

        scripts.add(`try {
          ${typeof script === "function" ? `(${script})();` : script}
          } catch (e) {
            console.error("Error in DocStartInjection script", e);
          }`
        );
      } catch (e) {
        error(`Error calling DocStartInjection scriptBuilder: buildScript ${buildScript} - script: ${script}`, e);
      }
    }));

    if (scripts.size === 0) {
      debug(`DocStartInjection: no script to inject in ${url}`);
      return;
    }

    const id = getId(request);

    const injectionId = `injection:${uuid()}:${await sha256(Math.random().toString(16))}`;
    const args = mv3Callbacks ?
    // mv3 browser.scripting.executeScript()
    {
      func: (url, injectionId, scripts) => {
        if (document.readyState === "complete" ||
            window[injectionId] ||
            document.URL !== url
        ) return window[injectionId];
        window[injectionId] = true;
        for (s of scripts) {
          const {data, callback, assign}  = s;
          try {
            if (assign && !(assign in globalThis)) {
              globalThis[assign] = data;
            }
            if (callback) {
              let cb = globalThis[callback];
              if (typeof cb == "function") {
                cb.call(globalThis, data);
              } else {
                console.warn(`callback globalThis.${callback} is not a function (${cb}).`);
              }
            }
          } catch (e) {
            console.error(`Error in DocStartInjection script ${JSON.stringify(s)}`, e);
          }
        }
        return document.readyState === "loading";
      },
      args: [url, injectionId, [...scripts]],
      target: documentId ? {tabId, documentIds: [documentId] } : {tabId, frameIds: [frameId]},
      injectImmediately: true,
    } :
    // mv2 browser.tabs.executeScript()
    {
      code: `(() => {
        let injectionId = ${JSON.stringify(injectionId)};
        if (document.readyState === "complete" ||
            window[injectionId] ||
            document.URL !== ${JSON.stringify(url)}
        ) return window[injectionId];
        window[injectionId] = true;
        ${[...scripts].join("\n")}
        return document.readyState === "loading";
      })();`,
      runAt: "document_start",
      frameId,
      matchAboutBlank: true, // prevent missing host permissions error on transition
    };
    pending.set(id, args);
    await run(request, true);
  }

  async function run(request, repeat = false) {
    const id = getId(request);
    const args = pending.get(id);
    if (!args) return;
    const {url, tabId, frameId} = request;
    let attempts = 0;
    let success = false;
    const execute = mv3Callbacks ?
      async () => {
        const ret = await browser.scripting.executeScript(args);
        return ret[0].result;
      }
    : async() => {
       const ret = await browser.tabs.executeScript(tabId, args);
       return ret[0];
    };
    const TIMEOUT = 3 * 60000 + Date.now();
    let checkingFrame;
    let isTargetedPage = false;
    for (; pending.has(id);) {
      attempts++;
      try {
        if (attempts % 1000 === 0) {
          const tab = await browser.tabs.get(tabId);
          if (request.type == "main_frame" && tab.url != url) {
            console.error(`Tab mismatch: ${tab.url} <> ${url} (download-triggered?)`);
            break;
          }
          console.error(`DocStartInjection at ${url} ${attempts} failed attempts so far...`);
        }
        if (await execute()) {
          success = true;
          break;
        }
      } catch (e) {
        if (/(?:No|Invalid) tab\b/.test(e.message)) {
          console.error(e);
          break;
        }
        if (args.target) {
          if (e.message == "Frame with ID 0 was removed.") {
            continue;
          }
          console.error(`MV3 fatality, cannot script target! ${JSON.stringify(args)}`);
          break;
        }
        if (!/\baccess|permission\b/.test(e.message)) {
          console.error(e);
        }

        checkingFrame ||=
          (async () => {
            try {
              const frame = await browser.webNavigation.getFrame({tabId: request.tabId, frameId: request.frameId});
              if (frame.url == url) {
                isTargetedPage = true;
              }
            } catch (e) {
              console.error(`Error looking for url ${url} at frame ${frameId} / tab ${tabId}`, e);
              checkingFrame = false;
            }
          })();
        if (isTargetedPage) {
          console.error(`Can't inject correctly targeted page at tab ${tabId}, frame ${frameId}, url ${url}. Maybe PDF or other privileged renderer? Giving up!`, e);
          break;
        }
        if (attempts % 1000 === 0) {
          console.error(`DocStartInjection at ${url} ${attempts} failed attempts`, e);
          if (Date.now() > TIMEOUT) {
            console.log("DocStartInjection timeout!");
            break;
          }
        }
      } finally {
        if (!repeat) break;
      }
    }
    pending.delete(id);
    debug(`DocStartInjection at ${url} (tabId: ${tabId}, frameId: ${frameId}), ${attempts} attempts, success = ${success}, repeat = ${repeat}.`);
  }

  function end(request) {
    const id = getId(request);
    const script = pending.get(id);
    if (script) {
      // last attempt
      run(request, false);
    }
  }

  let listeners = {
    onBeforeNavigate: begin,
    onDomContentLoaded: end,
    onErrorOccurred: end, // wr & wn
    onCompleted: end, // wr & wn
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

    setup(webRequest, "onResponseStarted", begin, reqFilter);
    if (isGecko) {
      // add or remove Firefox's webNavigation listeners for non-http loads
      let navFilter = enabled && {url: [{schemes: ["file", "ftp"]}]};
      for (let [eventName, listener] of Object.entries(listeners)) {
        setup(webNavigation, eventName, listener, navFilter);
      }
    }

    // add or remove common webRequest listeners
    for (let [eventName, listener] of Object.entries(listeners)) {
       setup(webRequest, eventName, listener, reqFilter);
    }
  }

  return {
    mv3Callbacks,
    register(scriptBuilder) {
      if (scriptBuilders.size === 0) listen(true);
      scriptBuilders.add(scriptBuilder);
    },
    unregister(scriptBuilder) {
      scriptBuilders.delete(scriptBuilder);
      if (scriptBuilders.size === 0) listen(false);
    }
  };
})();
