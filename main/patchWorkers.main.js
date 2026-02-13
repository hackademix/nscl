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

  let parentPatch;

  const modifyContext = (w, { port, xray }) => {
    if (!globalThis.Worker) {
      console.debug("Workers not supported in this context, bailing out", w, globalThis);
      return;
    }
    // cache and "protect" some "sensitive" built-ins we'll need later
    const {
      encodeURIComponent,
      ServiceWorkerContainer, URL, XMLHttpRequest, Blob,
      Proxy, Promise
    } = globalThis;


    const error = console.error.bind(console);

    const createObjectURL = URL.createObjectURL.bind(URL);
    const construct = Reflect.construct.bind(Reflect);
    const apply = Reflect.apply.bind(Reflect);

    const patchRemoteWorkerScript = (url, isServiceOrShared) =>
      port?.postMessage({
        type: "patchUrl",
        url,
        isServiceOrShared,
      });

    port?.postMessage({
        type: "propagate",
        modifyContext: modifyContext.toString(),
      });

    // patch Worker & SharedWorker
    const terminate = Worker.prototype.terminate;
    const baseURI = globalThis.document?.baseURI || location.href;
    const workerHandler = {
      construct(target, args) {
        // string coercion may have side effects, let's clear it up immediately
        args[0] = `${args[0]}`;
        let url;
        try {
          url = new URL(args[0], baseURI);
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

          parentPatch ||= port?.postMessage({
            type: "getPatch",
          });
          if (typeof parentPatch == "function") {
            parentPatch = `
              const parentPatch = ${parentPatch};
              const modifyContext = ${modifyContext};
              modifyContext(null, {});
              parentPatch();
            `;
          }
          // here we hide data URL modifications
          const patch = `{
            console.debug("Patching worker at " + self.location.href, typeof self.Worker); // DEV_ONLY
            let handler = {apply(target, thisArg, args) {
              return location === thisArg ? ${JSON.stringify(url)} : Reflect.apply(target, thisArg, args);
            }};
            const wlProto = WorkerLocation.prototype;
            const pd = Object.getOwnPropertyDescriptor(wlProto, "href");
            pd.get = new Proxy(pd.get, handler);
            Object.defineProperty(wlProto, "href", pd);
            wlProto.toString = new Proxy(wlProto.toString, handler);
          };
          {
            ${parentPatch}
          };
          `;
          args[0] = url.protocol === "data:" ?`data:application/javascript,${encodeURIComponent(`${patch};${content()}`)}`
          : createObjectURL(new Blob([patch, ";\n", content()], {type: "application/javascript"}));
          return construct(target, args);
        }
        // remote patching
        if (!w) {
          // nested, handle in services/patchWorker.js
          return construct(target, args);
        }
        url = url.href;
        patchRemoteWorkerScript(url, (target.wrappedJSObject || target) === w.SharedWorker);
        console.debug("Patching remote worker", url); // DEV_ONLY
        const worker = construct(target, args)
        failSafe.add(url, () => apply(terminate, worker, []));
        return worker;
      }
    };

    // Intercept worker constructors
    if (!xray) {
      // nested, just proxy Worker
      globalThis.Worker = new Proxy(Worker, workerHandler);
    } else {
      for (const clazz of ["Worker", "SharedWorker"]) {
        xray.proxify(clazz, workerHandler);
      }
    }

    // Intercept service worker registration
    if (xray && ServiceWorkerContainer) {
      const { origin }  = self.location;
      const { unregister, update } = ServiceWorkerRegistration.prototype;
      xray.proxify("register", {
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
            url = new URL(args[0], baseURI);
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
      }, ServiceWorkerContainer.prototype);
    }
    console.debug("Workers patched on", location.href); // DEV_ONLY
  }

  Worlds.connect("patchWorkers.main", {
    onConnect(port) {
      patchWindow(modifyContext, { port });
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
