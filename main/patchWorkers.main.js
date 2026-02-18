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
  const { console, patchWindow, exportFunction } = Worlds.main;

  const failSafe = (() => {
    const urls = new Map();
    const getResolver = url => {
      let resolver = urls.get(url);
      if (!resolver) {
        resolver = {};
        resolver.promise = new Promise((resolve, reject) => {
          resolver.resolve = resolve;
          resolver.reject = reject;
        });
        urls.set(url, resolver);
      };
      return resolver;
    };
    return {
      add(url) {
        return getResolver(url).promise;
      },
      ok(url) {
        getResolver(url).resolve(url);
      },
      cancel(url) {
        const e = new Error(`Patching cancelled for url ${url}`);
        e.url = url;
        getResolver(url).reject(e);
      },
    };
  })();

  let parentPatch;

  const modifyContext = (w, { port, xray }) => {
    if (!globalThis.Worker) {
      console.debug("Workers not supported in this context, bailing out", w, globalThis);
      return;
    }
    console.debug("patchWorker.modifyContext()", globalThis, globalThis.location?.href, globalThis.TOO_LATE ? "TOO LATE!" : "OK"); // DEV_ONLY
    // cache and "protect" some "sensitive" built-ins we'll need later
    const {
      encodeURIComponent,
      ServiceWorkerContainer, URL, XMLHttpRequest, Blob,
      Proxy, Promise
    } = globalThis;


    const error = console.error.bind(console);

    const createObjectURL = URL.createObjectURL.bind(URL);
    const constructWorker = Reflect.construct.bind(Reflect);
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
        return handlePatch(constructWorker, target, args);
      }
    };

    const createConstructorProxy = (Original) => {
      return new Proxy(Original, {
        construct(target, args) {
          const [url, options] = args;
          let realInstance = null;
          const queue = [];
          const listenerCache = new Map();

          const release = () => {
            realInstance = new Original(url, options);
            // Sync listeners
            listenerCache.forEach((items, type) => {
              items.forEach(item => realInstance.addEventListener(type, item.fn, item.opts));
            });
            // Replay actions
            queue.forEach(task => task(realInstance));
            queue.length = 0;
          };

          failSafe.add(url).then(release, e => console.error(e));

          return new Proxy({}, {
            get(t, prop) {
              if (realInstance) return Reflect.get(realInstance, prop);

              // Proxy methods from the original prototype
              if (typeof Original.prototype[prop] === 'function') {
                return (...mArgs) => {
                  if (prop === 'addEventListener') {
                    const [type, fn, opts] = mArgs;
                    if (!listenerCache.has(type)) listenerCache.set(type, []);
                    listenerCache.get(type).push({ fn, opts });
                  }
                  if (realInstance) return realInstance[prop](...mArgs);
                  queue.push(inst => inst[prop](...mArgs));
                };
              }
              return Reflect.get(t, prop);
            },
            set(t, prop, value) {
              if (realInstance) return Reflect.set(realInstance, prop, value);
              queue.push(inst => { inst[prop] = value; });
              return true;
            },
            getPrototypeOf() { return Original.prototype; }
          });
        },
        get(target, prop) {
          if (prop === 'prototype') return Original.prototype;
          return Reflect.get(target, prop);
        }
      });
    };

    const handlePatch = (createPatched, target, args) => {
      const isWorker = createPatched == constructWorker;
      // string coercion may have side effects, let's clear it up immediately
      args[0] = `${args[0]}`;
      let url;
      try {
        url = new URL(args[0], baseURI);
      } catch (e) {
        args[0] = "data:"; // Worker constructor doesn't care about URL validity
        return createPatched(target, args);
      }

      if (/^(?:data|blob):/.test(url.protocol) || !isWorker) {

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

        let patch = parentPatch ||
          port?.postMessage({
            type: "getPatch",
          });
        if (typeof patch == "function") {
          patch = `
            const parentPatch = ${patch};
            {
              const modifyContext = ${modifyContext};
              modifyContext(null, {});
            }
            parentPatch();
            `;
        }

        const preamble = isWorker ?
          // here we hide URL modifications
          `
            const location = globalThis.location;
            const url = new URL(${JSON.stringify(url)});

            console.debug("Patching worker", globalThis, location?.href); // DEV_ONLY
            const handler = name => {
            return {
                apply(target, thisArg, args) {
                  return location === thisArg ? url[name] : Reflect.apply(target, thisArg, args);
                }
              }
            };
            const wlProto = WorkerLocation.prototype;
            for (const [name, pd] of Object.entries(Object.getOwnPropertyDescriptors(wlProto))) {
              if ("get" in pd && name in url) {
                pd.get = new Proxy(pd.get, handler(name));
                Object.defineProperty(wlProto, name, pd);
              }
            }
            wlProto.toString = new Proxy(wlProto.toString, handler("href"));
            console.debug(Patched worker disguised location (was ${location})\`, globalThis.location); // DEV_ONLY
          `
          :
          `
            console.debug("Patching worklet", globalThis); // DEV_ONLY
          `;
        patch = `
          {
            ${preamble}
          }
          {
            ${patch}
          }
          `.replace(/^\s+/mg, '');
        args[0] = url.protocol === "data:" ? `data:application/javascript,${encodeURIComponent(`${patch};${content()}`)}`
          : createObjectURL(new Blob([patch, ";\n", content()], { type: "application/javascript" }));
        return createPatched(target, args);
      }
      // remote patching
      if (!w) {
        // nested, handle in services/patchWorker.js
        return createPatched(target, args);
      }
      url = url.href;
      patchRemoteWorkerScript(url, (target.wrappedJSObject || target) === w.SharedWorker);
      const isWorklet = createPatched != constructWorker;
      console.debug(`Patching remote ${isWorklet ? "worklet" : "worker"} worker`, url); // DEV_ONLY
      const worker = createPatched(target, args);
      return worker;
    };

    // Intercept worker constructors
    if (!xray) {
      // nested, just proxy Worker
      globalThis.Worker = new Proxy(Worker, workerHandler);
    } else {
      for (const clazz of ["Worker", "SharedWorker"]) {
        xray.proxify(clazz, workerHandler);
      }
      if (globalThis.Worklet) {
        const { prototype } = globalThis.Worklet;
        const { addModule } = prototype;
        exportFunction(function(...args) {
          return handlePatch(
           (target, args) => {
              console.debug("Worklet creation", target, args, this); // DEV_ONLY
              if (/^(?:data|blob):/.test(args[0])) {
                return addModule.apply(this, args);
              }
              const p = new w.Promise((resolve, reject) => {
                failSafe.add(args[0]).then(
                  () => {
                    resolve(addModule.apply(this, args));
                  },
                  () => resolve()
                );
              });
              return p;
            },
            this,
            args
          );
        }, prototype, { defineAs: "addModule" });
      }
    }

    // Intercept service worker registration
    if (xray && ServiceWorkerContainer) {
      const { origin }  = globalThis.location;
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
          failSafe?.add(url).then(
            () => {
              registration.then(r => apply(update, r, []));
            },
            () => {
              registration.then(r => apply(unregister, r, []));
            });
          return registration;
        }
      }, ServiceWorkerContainer.prototype);
    };

    console.debug("Workers patched on", location.href); // DEV_ONLY
  }

  Worlds.connect("patchWorkers.main", {
    onConnect(port) {
      patchWindow(modifyContext, { port });
    },
    onMessage(msg, {port}) {
      switch (msg.type) {
        case "patchedUrl":
          failSafe.ok(msg.url);
        break;
        case "cancelUrl":
          failSafe.cancel(msg.url);
        break;
      }
    },
  });
}
