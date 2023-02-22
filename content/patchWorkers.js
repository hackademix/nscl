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
"use strict";
var patchWorkers = (() => {
  let patches = new Set();
  let urls = new Set();

  let stringify = f => typeof f === "function" ? `(${f})();\n` : `{${f}}\n`;
  let joinPatches = () => [...patches].join("\n");

  return patch => {

    if (patches.size === 0) {
      let modifyWindow = (w, {port, xray}) => {

        let {window} = xray;

        let proxy2Object = new WeakMap();
        let shadows = new WeakMap();
        let workersByUrl = new Map();

        // cache and "protect" some "sensitive" built-ins we'll need later
        let { ServiceWorkerContainer, URL, XMLHttpRequest, Blob,
              Proxy, Promise } = window;
        let { SharedWorker, encodeURIComponent } = w;

        let createObjectURL = URL.createObjectURL.bind(URL);
        let construct = Reflect.construct.bind(Reflect);
        let error = console.error.bind(console);


        let proxify = (obj, handler) => {
            let proxy = new Proxy(xray.unwrap(obj), xray.forPage(handler));
            proxy2Object.set(proxy, obj);
            return proxy;
        };

        // with this handler we can forward property access as soon as deferred
        // objects are ready, using dummies in the meanwhile, for
        // Workers, SharedWorkers and SharedWorker.port
        let propHandler = {
          set(target, prop, value, receiver) {
            let sw = shadows.get(receiver);
            if (sw) {
              if (sw.finalObject) {
                target = sw.finalObject;
              } else {
                (sw.props || (sw.props = {}))[prop] = value;
              }
            }
            return Reflect.set(xray.unwrap(target), prop, value);
          },
          get(target, prop, receiver) {
            let sw = shadows.get(receiver);
            let obj = xray.unwrap(target);

            if (sw) {
              if (obj instanceof SharedWorker && prop === "port") {
                return sw.port;
              }
              if (sw.finalObject) obj = xray.unwrap(sw.finalObject);
            }
            return Reflect.get(obj, prop);
          }
        };

        function mustDeferWorker(url, isServiceOrShared) {
          if (!port.postMessage({type: "patchUrl", url, isServiceOrShared})) {
            let workers = workersByUrl.get(url);
            if (!workers) workersByUrl.set(url, workers = new Set());
            return workers;
          }
          return null;
        }

        // patch Worker & SharedWorker
        let workerHandler = {
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
              url = url.href;
              let workers = mustDeferWorker(url, (target.wrappedJSObject || target) === SharedWorker);
              if (workers) {
                args[0] = "data:"
                let worker = construct(target, args);
                let proxy = proxify(worker, propHandler);
                workers.add(proxy);
                let shadow = {url};
                shadows.set(proxy, shadow);
                if (worker.port) {
                  shadows.set(shadow.port = proxify(worker.port, propHandler), {worker});
                }
                return proxy;
              }
            }
            return construct(target, args);
          }
        };
        for (let c of ["Worker", "SharedWorker"]) {
          w[c] = proxify(window[c], workerHandler);
        }

        // patch Worker & SharedWorker.post to buffer postMessage() calls
        // and EventTarget to replay listeners addition/removal
        // until deferred objects are finally ready
        let replayCallsHandler = {
          apply(target, thisArg, args) {
            let sw = shadows.get(thisArg);
            args = xray.unwrap(args);
            if (!sw) return Reflect.apply(target, thisArg, args);
            if (sw.finalObject) return Reflect.apply(target, sw.finalObject, args);
            (sw.replayCalls = sw.replayCalls || []).push({target, args});
          }
        }
        try {
          let replayMethods = new Map();
          let eventTargetMethods = Object.keys(w.EventTarget.prototype); // ["addEventListener", "removeEventListener", "dispatchEvent"]
          for (let proto of [w.EventTarget.prototype, w.Worker.prototype.__proto__, w.SharedWorker.prototype.__proto__]) {
            replayMethods.set(proto, eventTargetMethods);
          }
          replayMethods.set(w.Worker.prototype, ["postMessage", "terminate"]);
          replayMethods.set(w.MessagePort.prototype, ["postMessage", "start", "close"]);

          for (let [proto, methods] of replayMethods.entries()) {
            for (let method of methods) {
              let des = Object.getOwnPropertyDescriptor(proto, method);
              des.value = xray.forPage(proxify(des.value, replayCallsHandler));
              Object.defineProperty(proto, method, des);
            }
          }
        } catch (e) {
          error(e);
        }
        let origin = window.location.origin;
        class Registration {
          constructor(complete) {
            this.complete = complete;
          }
        }
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
              let workers = mustDeferWorker(url);
              if (workers) {
                return new Promise(resolve => {
                  workers.add(new Registration(() => {
                    resolve(register())
                  }));
                });
              }
            } catch(e) {
              error(e);
            }
            return register();
          }
        });

        function finalizeShadow(dummy, finalObject) {
          let sw = shadows.get(dummy);
          if (!sw) return;
          sw.finalObject = sw.props ? Object.assign(finalObject, sw.props) : finalObject;
          delete sw.props;
          if (sw.port && finalObject.port) {
            finalizeShadow(sw.port, finalObject.port);
          }
          if (!sw.replayCalls) return;
          for (let {target, args} of sw.replayCalls) {
            try {
              Reflect.apply(target, finalObject, args);
            } catch(e) {
              error(e);
            }
          }
          delete sw.replayCalls;
        }

        port.onMessage = ({type, url}) => {
          if (type !== "urlPatched") return;
          let workers = workersByUrl.get(url);
          if (!workers) return;
          for (let worker of workers) {
            if (worker instanceof Registration) {
              worker.complete();
              continue;
            }
            finalizeShadow(worker, construct(proxy2Object.get(worker).constructor, [url]));
          }
          workersByUrl.delete(url);
        }
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
              return true;
            }
            browser.runtime.sendMessage({
              __patchWorkers__: { url, patch: joinPatches(), isServiceOrShared }
            }).then(() => {
              urls.add(url);
              port.postMessage({type: "urlPatched", url});
            });
          }
        }
      };
    }

    patches.add(stringify(patch));
  }
})();