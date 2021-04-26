// depends on nscl/content/patchWindow.js
"use strict";
var patchWorkers = (() => {
  let patches = new Set();
  let urls = new Set();

  let stringify = f => typeof f === "function" ? `(${f})();\n` : `{${f}}\n`;
  let joinPatches = () => [...patches].join("\n");

  return patch => {

    if (patches.size === 0) {
      let modifyWindow = (w, {port}) => {

        let xray = window.wrappedJSObject === w;
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

        let wo = obj => xray && obj.wrappedJSObject || obj;
        let proxify = (obj, handler) => {
            let proxy = new Proxy(wo(obj), cloneInto(handler, window, {cloneFunctions: true}));
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
            return Reflect.set(wo(target), prop, value);
          },
          get(target, prop, receiver) {
            let sw = shadows.get(receiver);
            let obj = wo(target);

            if (sw) {
              if (obj instanceof SharedWorker && prop === "port") {
                return sw.port;
              }
              if (sw.finalObject) obj = wo(sw.finalObject);
            }
            return Reflect.get(obj, prop);
          }
        };

        function mustDeferWorker(url, isService) {
          if (!port.postMessage({type: "patchUrl", url, isService})) {
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
              let workers = mustDeferWorker(url);
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
        // and EventTarget to replay liseners addition/removal
        // until deferred objects are finally ready
        let replayCallsHandler = {
          apply(target, thisArg, args) {
            let sw = shadows.get(thisArg);
            args = wo(args);
            if (!sw) return Reflect.apply(target, thisArg, args);
            if (sw.finalObject) return Reflect.apply(target, sw.finalObject, args);
            (sw.replayCalls = sw.replayCalls || []).push({target, args});
          }
        }
        try {
          let replayMethods = new Map();
          let eventTargetMethods = Object.keys(window.EventTarget.prototype); // ["addEventListener", "removeEventListener", "dispatchEvent"]
          for (let proto of [window.EventTarget.prototype, window.Worker.prototype.__proto__, window.SharedWorker.prototype.__proto__]) {
            replayMethods.set(proto, eventTargetMethods);
          }
          replayMethods.set(window.Worker.prototype, ["postMessage", "terminate"]);
          replayMethods.set(window.MessagePort.prototype, ["postMessage", "start"]);

          for (let [proto, methods] of replayMethods.entries()) {
            for (let method of methods) {
              wo(proto)[method] = cloneInto(proxify(wo(proto)[method], replayCallsHandler), window, {cloneFunctions: true});
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
        wo(ServiceWorkerContainer.prototype).register = proxify(ServiceWorkerContainer.prototype.register, {
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
            let {url, isService} = msg;
            url = `${url}`;
            if (urls.has(url) && !isService) {
              return true;
            }
            browser.runtime.sendMessage({
              __patchWorkers__: { url, patch: joinPatches(), isService }
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