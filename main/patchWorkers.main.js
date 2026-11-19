
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
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

"use strict";
{
  const { console, patchWindow, exportFunction } = Worlds.main;

  // Self-contained factory, so its source can be propagated to nested workers.
  const createFailSafe = () => {
    const { Map, Promise, URL, Error, document, location, Reflect, Object } = globalThis;
    const { apply } = Reflect;
    const { get: mapGet, set: mapSet } = Map.prototype;
    const { getOwnPropertyDescriptor } = Object;
    const urlHrefGetter = URL?.prototype
        && apply(getOwnPropertyDescriptor, Object, [URL.prototype, "href"])?.get;
    const baseURI = document?.baseURI || location?.href;
    const urls = new Map();

    const getResolver = url => {
      let resolver = apply(mapGet, urls, [url]);
      if (!resolver) {
        let resolve, reject;
        const promise = new Promise((ok, ko) => {
          resolve = ok;
          reject = ko;
        });
        resolver = { promise, resolve, reject };
        apply(mapSet, urls, [url, resolver]);
      }

      return resolver;
    };

    const normalizeURL = url => {
      try {
        return apply(urlHrefGetter, new URL(url, baseURI), []);
      } catch (e) {
        console.error(`Could not resolve ${url} to an absolute URL!`);
        return url;
      }
    };

    return {
      add(url) {
        console.debug(`failSafe.add("${url}")`); // DEV_ONLY
        // always use an absolute URL, because it's what ok() and cancel() will get
        return getResolver(normalizeURL(url)).promise;
      },
      ok(url) {
        console.debug(`failSafe.ok("${url}")`, getResolver(url)); // DEV_ONLY
       apply(getResolver(url).resolve, undefined, [url]);
      },
      cancel(url) {
        console.debug(`failSafe.cancel("${url}")`); // DEV_ONLY
        const e = new Error(`Patching cancelled for url ${url}`);
        e.url = url;
        apply(getResolver(url).reject, undefined, [e]);
      },
    };
  };

  const failSafe = createFailSafe();

  const proxyWorkers = window?.wrappedJSObject
    ? () => { }
    : () => {
      // Chromium only

      // Capture intrinsics before page code gets a chance to tamper with them.
      const { Map, Reflect, RegExp, Array, Promise, Proxy, Object, Function, MessagePort } = globalThis;
      const { apply, construct, get, set } = Reflect;
      const { test: regexpTest } = RegExp.prototype;
      const inlineURLPattern = /^(?:data|blob):/;
      const { has: mapHas, get: mapGet, set: mapSet, forEach: mapForEach } = Map.prototype;
      const { push: arrayPush, forEach: arrayForEach } = Array.prototype;
      const { then: promiseThen } = Promise.prototype;

      const Originals = {
        Worker: window.Worker,
        SharedWorker: window.SharedWorker,
        getDescriptor: Object.getOwnPropertyDescriptor,
        toString: Function.prototype.toString
      };

      // Cache MessagePort methods used by the SharedWorker port proxy.
      const portMethods = Object.create(null);
      for (const name of [
        "addEventListener", "removeEventListener", "start", "close", "postMessage"
      ]) {
        portMethods[name] = MessagePort.prototype[name];
      }

      const createConstructorProxy = original => {
        const originalPrototype = original.prototype;
        const isSharedWorker = original === Originals.SharedWorker;

        // Cache the instance methods used by the proxy.
        const instanceMethods = Object.create(null);
        for (const name of [
          "postMessage", "terminate",
          "addEventListener", "removeEventListener", "dispatchEvent"
        ]) {
          instanceMethods[name] = originalPrototype[name];
        }

        return originalPrototype.constructor = new Proxy(original, {
          construct(target, args) {
            if (apply(regexpTest, inlineURLPattern, [args[0]])) {
              return apply(construct, Reflect, [original, args]);
            }

            let realInstance = null;
            const instQueue = [];
            const instListeners = new Map();

            // Setup Port Proxy specifically for SharedWorker
            let realPort = null;
            const portQueue = [];
            const portListeners = new Map();

            const portProxy = isSharedWorker ? new Proxy({}, {
              get(t, prop) {
                if (realPort) return apply(get, Reflect, [realPort, prop]);

                const method = portMethods[prop];
                if (typeof method === "function") {
                  return (...mArgs) => {
                    if (prop === "addEventListener") {
                      const type = mArgs[0];
                      let list;
                      if (apply(mapHas, portListeners, [type])) {
                        list = apply(mapGet, portListeners, [type]);
                      } else {
                        list = [];
                        apply(mapSet, portListeners, [type, list]);
                      }
                      apply(arrayPush, list, [{
                        fn: mArgs[1],
                        opts: mArgs[2]
                      }]);
                    }

                    if (realPort) {
                      return apply(method, realPort, mArgs);
                    }

                    apply(arrayPush, portQueue, [
                      p => apply(method, p, mArgs)
                    ]);
                  };
                }

                return apply(get, Reflect, [t, prop]);
              },

              set(t, prop, value) {
                if (realPort) return apply(set, Reflect, [realPort, prop, value]);

                apply(arrayPush, portQueue, [
                  p => { p[prop] = value; }
                ]);
                return true;
              }
            }) : null;

            const release = () => {
              realInstance = apply(construct, Reflect, [original, args]);

              // If this is a SharedWorker, initialize the port proxy.
              if (isSharedWorker && realInstance.port) {
                realPort = realInstance.port;

                apply(mapForEach, portListeners, [
                  (list, type) => {
                    apply(arrayForEach, list, [
                      item => apply(portMethods.addEventListener, realPort, [
                        type, item.fn, item.opts
                      ])
                    ]);
                  }
                ]);

                apply(arrayForEach, portQueue, [
                  task => task(realPort)
                ]);
              }

              // Replay instance listeners and actions.
              apply(mapForEach, instListeners, [
                (list, type) => {
                  apply(arrayForEach, list, [
                    item => apply(instanceMethods.addEventListener, realInstance, [
                      type, item.fn, item.opts
                    ])
                  ]);
                }
              ]);

              apply(arrayForEach, instQueue, [
                task => task(realInstance)
              ]);
            };

            apply(promiseThen, failSafe.add(args[0]), [release]);

            return new Proxy({}, {
              get(t, prop) {
                // Check reference for SharedWorker port access.
                if (prop === "port" && isSharedWorker) return portProxy;
                if (realInstance) return apply(get, Reflect, [realInstance, prop]);

                const method = instanceMethods[prop];
                if (typeof method === "function") {
                  return (...mArgs) => {
                    if (prop === "addEventListener") {
                      const type = mArgs[0];
                      let list;
                      if (apply(mapHas, instListeners, [type])) {
                        list = apply(mapGet, instListeners, [type]);
                      } else {
                        list = [];
                        apply(mapSet, instListeners, [type, list]);
                      }
                      apply(arrayPush, list, [{
                        fn: mArgs[1],
                        opts: mArgs[2]
                      }]);
                    }

                    if (realInstance) {
                      return apply(method, realInstance, mArgs);
                    }

                    apply(arrayPush, instQueue, [
                      inst => apply(method, inst, mArgs)
                    ]);
                  };
                }

                return apply(get, Reflect, [t, prop]);
              },

              set(t, prop, value) {
                if (realInstance) return apply(set, Reflect, [realInstance, prop, value]);

                apply(arrayPush, instQueue, [
                  inst => { inst[prop] = value; }
                ]);
                return true;
              },

              getPrototypeOf() {
                return originalPrototype;
              }
            });
          },

          get(target, prop) {
            if (prop === "prototype") return originalPrototype;
            return apply(get, Reflect, [target, prop]);
          }
        });
      };

      // 1. Initialize Global Proxies
      window.Worker = createConstructorProxy(Originals.Worker);
      window.SharedWorker = createConstructorProxy(Originals.SharedWorker);

      // 2. Disguise Property Descriptors
      Object.getOwnPropertyDescriptor = function (obj, prop) {
        if (obj === window && (prop === "Worker" || prop === "SharedWorker")) {
          return {
            value: window[prop],
            writable: true, enumerable: false, configurable: true
          };
        }
        return apply(Originals.getDescriptor, this, arguments);
      };

      // 3. Mask toString()
      const hide = (p, o) => {
        p.toString = function () {
          return apply(Originals.toString, o, []);
        };
      };
      hide(window.Worker, Originals.Worker);
      hide(window.SharedWorker, Originals.SharedWorker);
    };


  let parentPatch;
  let bcID;

  const modifyContext = (w, { port, xray }) => {
    if (!globalThis.Worker) {
      console.debug("Workers not supported in this context, bailing out", w, globalThis);
      return;
    }
    console.debug("patchWorker.modifyContext()", globalThis, globalThis.location?.href, globalThis.TOO_LATE ? "TOO LATE!" : "OK"); // DEV_ONLY

    // Capture the intrinsics used below before page code can replace them.
    const {
      encodeURIComponent,
      ServiceWorkerContainer,
      ServiceWorkerRegistration,
      URL,
      XMLHttpRequest,
      Blob,
      Proxy,
      Promise,
      TrustedTypePolicyFactory,
      BroadcastChannel,
      TrustedTypePolicy,
      RegExp,
      Set,
      JSON,
      Object,
      Symbol,
      Function,
      Math,
      Error,
      Reflect,
      Worker,
      SharedWorker,
      Worklet,
      location,
      document,
      trustedTypes
    } = globalThis;

    const { apply, construct } = Reflect;
    const { then: promiseThen } = Promise.prototype;
    const { test: regexpTest } = RegExp.prototype;
    const inlineURLPattern = /^(?:data|blob):/;
    const { stringify: jsonStringify } = JSON;
    const { getOwnPropertyDescriptor } = Object;
    const { iterator: iteratorSymbol } = Symbol;
    const { toString: fnToString } = Function.prototype;
    const { has: setHas, add: setAdd, delete: setDelete } = Set.prototype;
    const { open: xhrOpen, send: xhrSend } = XMLHttpRequest.prototype;
    const xhrResponseTextGetter =
      getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText")?.get;
    const hasMozSystem = "mozSystem" in XMLHttpRequest.prototype;

    const urlHrefGetter =
      getOwnPropertyDescriptor(URL.prototype, "href")?.get;
    const urlProtocolGetter =
      getOwnPropertyDescriptor(URL.prototype, "protocol")?.get;
    const urlOriginGetter =
      getOwnPropertyDescriptor(URL.prototype, "origin")?.get;

    const getURLHref = url => apply(urlHrefGetter, url, []);
    const getURLProtocol = url => apply(urlProtocolGetter, url, []);
    const getURLOrigin = url => apply(urlOriginGetter, url, []);

    const urlCreateObjectURL = URL.createObjectURL;
    const createObjectURL = blob => apply(urlCreateObjectURL, URL, [blob]);

    const promiseReject = Promise.reject;
    const mathRandom = Math.random;
    const trustedPolicyCreateScriptURL =
      TrustedTypePolicy?.prototype?.createScriptURL;

    const consoleError = console.error;
    const error = (...args) => apply(consoleError, console, args);

    // Abstract ToString semantics: unlike String(Symbol()), this throws
    // for a Symbol, as Web IDL string conversion does.
    const toDOMString = value => `${value}`;

    // Blob's parts argument is a Web IDL sequence and accepts any iterable.
    // This avoids depending on Array.prototype[Symbol.iterator] and avoids
    // concatenating large worker scripts into another large string.
    const scriptBlob = (...parts) => {
      let index = 0;
      const iterable = {
        __proto__: null,
        [iteratorSymbol]() {
          return {
            __proto__: null,
            next() {
              const done = index >= parts.length;
              return {
                __proto__: null,
                value: done ? undefined : parts[index++],
                done,
              };
            },
          };
        },
      };
      return new Blob(iterable, {
        __proto__: null,
        type: "application/javascript",
      });
    };

    // Read only recognized dictionary members. Ordinary property access
    // preserves inherited members, unlike object spread.
    const normalizeOptions = (source, isWorker) => {
      source = xray ? xray.unwrap(source) : source;
      const result = { __proto__: null };
      if (source == null) return result;

      const type = source.type;
      if (type !== undefined) result.type = toDOMString(type);

      const credentials = source.credentials;
      if (credentials !== undefined) {
        result.credentials = toDOMString(credentials);
      }

      if (isWorker) {
        const name = source.name;
        if (name !== undefined) result.name = toDOMString(name);
      }

      return result;
    };

    const trustedTypeSupport = TrustedTypePolicyFactory
      ? (() => {
        let policy = null;
        let policyCreateScriptURL = trustedPolicyCreateScriptURL;
        const authorized = new Set();

        const { prototype } = TrustedTypePolicyFactory;
        const { createPolicy } = prototype;

        const handler = {
          apply(target, thisArg, args) {
            if (xray) {
              args = xray.unwrap(args);
            }
            const [name, rules] = args;
            console.debug("Proxying TrustedTypePolicy", name, rules); // DEV_ONLY

            const originalCreateScriptURL = rules?.createScriptURL;
            if (typeof originalCreateScriptURL !== "function") {
              return apply(target, thisArg, args);
            }

            const interceptedRules = {
              __proto__: null,
              ...rules,
              createScriptURL(input, ...rest) {
                if (apply(setHas, authorized, [input])) return input;
                return apply(originalCreateScriptURL, this, [input, ...rest]);
              }
            };

            policy = apply(target, thisArg, [name, interceptedRules]);
            if (!policyCreateScriptURL) {
              policyCreateScriptURL = policy.createScriptURL;
            }
            return policy;
          }
        };

        if (xray) {
          xray.proxify("createPolicy", handler, prototype);
        } else {
          prototype.createPolicy = new Proxy(createPolicy, handler);
        }

        return {
          createScriptURL(s) {
            s = toDOMString(s);
            apply(setAdd, authorized, [s]);
            try {
              console.debug("trustedTypeSupport.createScriptURL", s, policy, new Error().stack); // DEV_ONLY
              if (!policy) {
                policy = apply(createPolicy, trustedTypes, [
                  "noscript",
                  {
                    __proto__: null,
                    createScriptURL(s) { return s; }
                  }
                ]);
                if (!policyCreateScriptURL) {
                  policyCreateScriptURL = policy.createScriptURL;
                }
              }
              return policy && policyCreateScriptURL
                ? apply(policyCreateScriptURL, policy, [s])
                : s;
            } finally {
              apply(setDelete, authorized, [s]);
            }
          }
        };
      })()
      : {
        createScriptURL(s) {
          return toDOMString(s);
        },
      };

    const constructWorker = (target, args) => {
      if (args.length) {
        args[0] = trustedTypeSupport.createScriptURL(args[0]);
      }
      return construct(target, xray?.unwrap(args) || args);
    };

    let bc;
    let bcPostMessage;
    const portPostMessage = port?.postMessage;

    if (!port && bcID && location.protocol != "data:") {
      try {
        bc = new BroadcastChannel(bcID);
        bcPostMessage = bc.postMessage;
        bc.addEventListener("message", ({ data: msg }) => {
          switch (msg.type) {
            case "patchedUrl":
              failSafe.ok(msg.url);
            break;
            case "cancelUrl":
              failSafe.cancel(msg.url);
            break;
          }
        });
      } catch (e) {
        error(e);
      }
    }

    const sendMessage = message => {
      if (port) return apply(portPostMessage, port, [message]);
      if (bc) return apply(bcPostMessage, bc, [message]);
    };

    const patchRemoteWorkerScript = (url, isServiceOrShared) =>
      sendMessage({
        type: "patchUrl",
        url,
        isServiceOrShared,
      });

    if (port) {
      apply(portPostMessage, port, [{
        type: "propagate",
        modifyContext: apply(fnToString, modifyContext, []),
        createFailSafe: apply(fnToString, createFailSafe, []),
      }]);
    }

    // patch Worker & SharedWorker
    const baseURI = document?.baseURI || location.href;
    const workerHandler = {
      construct(target, args) {
        return handlePatch(constructWorker, target, args);
      }
    };
    const sharedWorkerHandler = {
      construct(target, args) {
        return handlePatch(constructWorker, target, args, /* isServiceOrShared */ true);
      }
    };

    const handlePatch = (createPatched, target, args, isServiceOrShared = false) => {
      const isWorker = createPatched === constructWorker;
      const argc = args.length;

      // Preserve the distinction between a missing argument and explicit
      // undefined. Let the native constructor handle a missing URL argument.
      if (argc === 0) {
        return createPatched(target, args);
      }

      args = [args[0], args[1]];
      args[0] = toDOMString(args[0]);

      // SharedWorker has a legacy second-argument string-name overload.
      // Do not treat strings passed to other constructors as that overload.
      const legacySharedWorkerName =
        isWorker &&
        target === SharedWorker &&
        typeof args[1] === "string";

      let isModule = !isWorker;

      if (legacySharedWorkerName) {
        args[1] = toDOMString(args[1]);
      } else {
        args[1] = normalizeOptions(args[1], isWorker);
        isModule = isWorker && args[1].type === "module";
      }

      let url;
      try {
        url = new URL(args[0], baseURI);
      } catch (e) {
        args[0] = "data:"; // Worker constructor doesn't care about URL validity
        return createPatched(target, args);
      }

      if (apply(regexpTest, inlineURLPattern, [getURLProtocol(url)])) {

        // Inline patching

        const loadWorkerSrc = () => {
          try {
            const xhr = new XMLHttpRequest();
            apply(xhrOpen, xhr, ["GET", url, false]);
            apply(xhrSend, xhr, [null]);
            return apply(xhrResponseTextGetter, xhr, []);
          } catch (e) {
            error(e);
            // On Chromium this error may mean CSP is blocking this blob: / data: xhr,
            // we can try to fall back on remote patching / debugger API by returning null.
            // On Firefox we use privileged xhr, so we better err on the safe side and
            // return an empty string to "neuter" the worker.
            return hasMozSystem ? "" : null;
          }
        };

        let patch = parentPatch ||
          (port && apply(portPostMessage, port, [{
            type: "getPatch",
          }]));

        if (typeof patch == "function") {
          patch = `
            const parentPatch = ${apply(fnToString, patch, [])};
            {
              const createFailSafe = ${apply(fnToString, createFailSafe, [])};
              const failSafe = createFailSafe();
              const bcID = "${bcID}";
              const modifyContext = ${modifyContext};
              modifyContext(null, {});
            }
            parentPatch();
            `;
        }

        const preamble = isWorker ?
          // here we hide URL modifications
          `
            const { apply } = Reflect;
            const location = globalThis.location;
            const url = new URL(${apply(jsonStringify, JSON, [getURLHref(url)])});

            console.debug("Patching worker", globalThis, location?.href); // DEV_ONLY
            const handler = name => {
            return {
                apply(target, thisArg, args) {
                  return location === thisArg ? url[name] : apply(target, thisArg, args);
                }
              }
            }
            const wlProto = WorkerLocation.prototype;
            for (const [name, pd] of Object.entries(Object.getOwnPropertyDescriptors(wlProto))) {
              if ("get" in pd && name in url) {
                pd.get = new Proxy(pd.get, handler(name));
                Object.defineProperty(wlProto, name, pd);
              }
            }
            wlProto.toString = new Proxy(wlProto.toString, handler("href"));
            console.debug(\`Patched worker disguised location (was \${location})\`, globalThis.location); // DEV_ONLY
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
          `;

        const workerSrc = loadWorkerSrc();
        if (workerSrc !== null) {
          if (isModule) {
            patch = `import "${
              getURLProtocol(url) == "data:"
                ? `data:application/javascript,${encodeURIComponent(patch)}`
                : createObjectURL(scriptBlob(patch))
            }"`;
          }

          args[0] = getURLProtocol(url) === "data:"
            ? `data:application/javascript,${encodeURIComponent(`${patch};${workerSrc}`)}`
            : createObjectURL(scriptBlob(patch, ";\n", workerSrc));

          return createPatched(target, args);
        }
      }

      // remote patching
      url = getURLHref(url);
      patchRemoteWorkerScript(url, isServiceOrShared);
      console.debug(`Patching remote ${isWorker ? "worker" : "worklet"}`, url); // DEV_ONLY
      const worker = createPatched(target, args);
      return worker;
    };

    // Intercept worker constructors
    if (!xray) {
      // nested, just proxy Worker
      globalThis.Worker = Worker.prototype.constructor = new Proxy(Worker, workerHandler);
    } else {
      xray.proxify("Worker", workerHandler);
      xray.proxify("SharedWorker", sharedWorkerHandler);
      if (Worklet) {
        const { prototype } = Worklet;
        const { addModule } = prototype;
        exportFunction(function (...args) {
          return handlePatch(
            (target, args) => {
              console.debug("Worklet creation", target, args, this); // DEV_ONLY
              if (apply(regexpTest, inlineURLPattern, [args[0]])) {
                return apply(addModule, this, args);
              }
              const patching = apply(promiseThen, failSafe.add(args[0]), [
                () => {
                  args[0] = trustedTypeSupport.createScriptURL(
                    `${args[0]}#${apply(mathRandom, Math, [])}`
                  );
                  return apply(addModule, this, args);
                },
                e => {
                   error(e);
                   // do not propagate failSafe failure
                }
              ]);
              // Synthetic thenable work-around for xray breaking consumers of Promise objects
              // with `Permission denied to access property "then"`)
              const addingModule = {
                then: (resolve, reject) => {
                  return apply(promiseThen, patching, [resolve, reject]);
                },
                catch(reject) {
                  return apply(promiseThen, patching, [undefined, reject]);
                },
                finally(resolve) {
                  return this.then(resolve);
                }
              };
              return xray.forPage(addingModule);
            },
            this,
            args
          );
        }, prototype, { defineAs: "addModule" });
      }
    }

    // Intercept service worker registration
    if (xray && ServiceWorkerContainer) {
      const { origin } = location;
      const { unregister, update } = ServiceWorkerRegistration.prototype;
      xray.proxify("register", {
        apply(target, thisArg, args) {
          console.debug("Patching service worker", args); // DEV_ONLY
          try {
            // handle string coercion and its potential side effects right away
            args[0] = trustedTypeSupport.createScriptURL(args[0]);
          } catch (e) {
            return apply(promiseReject, Promise, [e]);
          }
          if (args[1] && args[1].updateViaCache === "all") {
            args[1].updateViaCache = "imports";
          }
          let url;
          try {
            url = new URL(args[0], baseURI);
            if (getURLOrigin(url) !== origin) throw new Error(`ServiceWorker origin mismatch (${getURLHref(url)})`);
            url = getURLHref(url);
            patchRemoteWorkerScript(url, /* isServiceOrShared */ true);
          } catch(e) {
            error(e);
          }
          const registration = apply(target, thisArg, args);
          apply(promiseThen, failSafe.add(url), [
            () => {
              apply(promiseThen, registration, [r => apply(update, r, [])]);
            },
            () => {
              apply(promiseThen, registration, [r => apply(unregister, r, [])]);
            }
          ]);
          return registration;
        }
      }, ServiceWorkerContainer.prototype);
    }

    console.debug("Workers patched on", location.href); // DEV_ONLY
  }

  Worlds.connect("patchWorkers.main", {
    onMessage(msg, { port }) {
      console.debug("patchWorkers.main message", msg); // DEV_ONLY
      switch (msg.type) {
        case "init":
          bcID = msg.bcID;
          proxyWorkers();
          patchWindow(modifyContext, { port });
        break;
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
