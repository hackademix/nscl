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
  const {console, patchWindow} = Worlds.main;

  const failSafe = (() => {
    const urls = new Map();
    const getCallbacks = url => {
      let ret = urls.get(url);
      if (!ret) {
        urls.set(ret = new Set());
      };
      return ret;
    };
    return {
      add(url, cancel) {
        getCallbacks(url).add(cancel);
      },
      cancel(url) {
        for (let c of [...getCallbacks(url)]) {
          try {
            c();
          } catch (e) {
            console.error(e);
          }
        }
      },
    };
  })();

  function modifyWindow(w, {port, xray}) {

    const {window} = xray;

    // cache and "protect" some "sensitive" built-ins we'll need later
    const { ServiceWorkerContainer, URL, XMLHttpRequest, Blob,
          Proxy, Promise } = window;
    const { SharedWorker, encodeURIComponent } = w;

    const error = console.error.bind(console);

    const createObjectURL = URL.createObjectURL.bind(URL);
    const construct = Reflect.construct.bind(Reflect);
    const apply = Reflect.apply.bind(Reflect);

    const proxify = (obj, handler) => new Proxy(xray.unwrap(obj), xray.forPage(handler));

    const patchRemoteWorkerScript = (url, isServiceOrShared) =>
      port.postMessage({type: "patchUrl", url, isServiceOrShared});

    // patch Worker & SharedWorker
    const terminate = Worker.prototype.terminate;
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
          return construct(target, args);
        }
        // remote patching
        url = url.href;
        patchRemoteWorkerScript(url, (target.wrappedJSObject || target) === SharedWorker);
        console.debug("Patching remote worker", url); // DEV_ONLY
        const worker = construct(target, args)
        failSafe.add(url, () => apply(terminate, worker, []));
        return worker;
      }
    };

    // Intercept worker constructors
    for (let c of ["Worker", "SharedWorker"]) {
      w[c] = proxify(window[c], workerHandler);
    }

    // Intercept service worker registration
    const origin = window.location.origin;
    if (ServiceWorkerContainer) {
      const {unregister, update} = ServiceWorkerRegistration.prototype;
      xray.unwrap(ServiceWorkerContainer.prototype).register = proxify(ServiceWorkerContainer.prototype.register, {
        apply(target, thisArg, args) {
          console.debug("Patching service worker", args); // DEV_ONLY
          try {
            // handle string coercion and its potential side effects right away
            args[0] = `${args[0]}`;
          } catch (e) {
            return Promise.reject(e);
          }
          if (args[1] && args[1].updateViaCache === "all") {
            args[1].updateViaCache = "imports";
          }
          let url;
          try {
            url = new URL(args[0], document.baseURI);
            if (url.origin !== origin) throw new Error("ServiceWorker origin mismatch (${url})");
            url = url.href;
            patchRemoteWorkerScript(url, /* isServiceOrShared */ true);
          } catch(e) {
            error(e);
          }
          const registration = apply(target, thisArg, args);
          failSafe.add(url, () => {
            registration.then(r => apply(unregister, r, []));
          });
          registration.then(r => apply(update, r, []));
          return registration;
        }
      });
    }
    console.debug("Workers patched on", location.href); // DEV_ONLY
  }

  Worlds.connect("patchWorkers.main", {
    onConnect(port) {
      patchWindow(modifyWindow, {port});
    },
    onMessage(msg, {port}) {
      switch(msg.type) {
        case "cancelUrl":
          failSafe.cancel(msg.url);
        break;
      }
    },
  });
}