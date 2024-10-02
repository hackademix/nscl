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

// depends on nscl/content/patchWindow.js
// depends on nscl/common/SyncMessage.js

"use strict";
var patchWorkers = (() => {
  let patches = new Set();
  let urls = new Set();

  let stringify = f => typeof f === "function" ? `(${f})();\n` : `{${f}}\n`;

  const debugMonitor = `
    for (let et of ['message', 'error', 'messageerror']) {
      addEventListener(et, ev => {
        console.debug("%s Event in patched worker", ev.type, ev.data);
      }, true);
    }`;
  const wrap = code => `(() => {
    try {
      if (!(self instanceof WorkerGlobalScope)) return false;
    } catch(e) {
      return false;
    }

    // preserve console from rewriting / erasure
    const console = Object.fromEntries(Object.entries(self.console).map(([n, v]) => v.bind ? [n, v.bind(self.console)] : [n,v]));

    ${debugMonitor} // DEV_ONLY
    try {
      ${code};
    } catch(e) {
      console.error("Error executing worker patch", e);
    }
    return true;
  })();
  `;
  const joinPatches = () => wrap([...patches].join("\n"));

  return patch => {

    if (patches.size === 0) {
      let modifyWindow = (w, {port, xray}) => {

        const {window} = xray;

        // cache and "protect" some "sensitive" built-ins we'll need later
        const { ServiceWorkerContainer, URL, XMLHttpRequest, Blob,
              Proxy, Promise } = window;
        const { SharedWorker, encodeURIComponent } = w;

        const error = console.error.bind(console);

        const createObjectURL = URL.createObjectURL.bind(URL);
        const construct = Reflect.construct.bind(Reflect);

        const proxify = (obj, handler) => new Proxy(xray.unwrap(obj), xray.forPage(handler));

        const patchRemoteWorkerScript = (url, isServiceOrShared) =>
          port.postMessage({type: "patchUrl", url, isServiceOrShared});

        // patch Worker & SharedWorker
        const workerHandler = {
          construct(target, args) {
            // string coercion may have side effects, let's clear it up immediately
            args[0] = `${args[0]}`;
            let url;
            try {
              url = new URL(args[0], document.baseURI);
            } catch (e) {
              args[0] = "data:"; // Worker constructor doesn't care about URL validity
              return construct(target, args);
            }

            if (/^(?:data|blob):/.test(url.protocol)) {

              // Inline patching

              let content = () => {
                try {
                  let xhr = new XMLHttpRequest();
                  xhr.open("GET", url, false);
                  xhr.send(null);
                  return xhr.responseText;
                } catch (e) {
                  error(e);
                  return "";
                }
              };

              let patch = port.postMessage({type: "getPatch"});
              // here we hide data URL modifications
              patch = `{
                let handler = {apply(target, thisArg, args) {
                  return location === thisArg ? ${JSON.stringify(url)} : Reflect.apply(target, thisArg, args);
                }};
                let wlProto = WorkerLocation.prototype;
                let pd = Object.getOwnPropertyDescriptor(wlProto, "href");
                pd.get = new Proxy(pd.get, handler);
                Object.defineProperty(wlProto, "href", pd);
                wlProto.toString = new Proxy(wlProto.toString, handler);
              }
              ${patch}`;
              args[0] = url.protocol === "data:" ?`data:application/javascript,${encodeURIComponent(`${patch};${content()}`)}`
              : createObjectURL(new Blob([patch, ";\n", content()], {type: "application/javascript"}));

            } else {
              // remote patching
              patchRemoteWorkerScript(url.href, (target.wrappedJSObject || target) === SharedWorker);
              console.debug("Patching remote worker", url.href); // DEV_ONLY
            }
            return construct(target, args);
          }
        };

        // Intercept worker constructors
        for (let c of ["Worker", "SharedWorker"]) {
          w[c] = proxify(window[c], workerHandler);
        }

        // Intercept service worker registration
        const origin = window.location.origin;
        if (ServiceWorkerContainer) xray.unwrap(ServiceWorkerContainer.prototype).register = proxify(ServiceWorkerContainer.prototype.register, {
          apply(target, thisArg, args) {
            let register = () => Reflect.apply(target, thisArg, args);
            try {
              // handle string coercion and its potential side effects right away
              args[0] = `${args[0]}`;
            } catch (e) {
              return Promise.reject(e);
            }
            try {
              let url = new URL(args[0], document.baseURI);
              if (url.origin !== origin) throw new Error("ServiceWorker origin mismatch (${url})");
              patchRemoteWorkerScript(url);
            } catch(e) {
              error(e);
            }
            return register();
          }
        });
      }

      let port = patchWindow(modifyWindow);
      port.onMessage = msg => {
        switch(msg.type) {
          case "getPatch":
            return joinPatches();
          case "patchUrl":
          {
            let {url, isServiceOrShared} = msg;
            url = `${url}`;
            if (urls.has(url) && !isServiceOrShared) {
              return false;
            }

            browser.runtime.sendSyncMessage({
              __patchWorkers__: { url, patch: joinPatches(), isServiceOrShared }
            });
            urls.add(url);
            return true;
          }
        }
      };
    }

    patches.add(stringify(patch));
  }
})();