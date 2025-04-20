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

if (globalThis.Worlds?.main) {
  const {Function, Object, Proxy, Promise, Reflect, WeakMap} = globalThis;
  const {
    console,
    exportFunction,
    xray,
    patchWindow,
  } = Object.freeze(Object.assign(Worlds.main, {

    cloneInto: globalThis.cloneInto || (o => o),

    exportFunction: globalThis.exportFunction || ((func, targetObject, {defineAs, original} = {}) => {
      try {
        let  [propDef, getOrSet, propName] = defineAs && /^([gs]et)(?:\s+(\w+))$/.exec(defineAs) || [null, null, defineAs];
        let propDes = propName && Object.getOwnPropertyDescriptor(targetObject, propName);
        if (getOrSet && !propDes) { // escalate through prototype chain
          for (let proto = Object.getPrototypeOf(targetObject); proto; proto = Object.getPrototypeOf(proto)) {
            propDes = Object.getOwnPropertyDescriptor(proto, propName);
            if (propDes) {
              targetObject = proto;
              break;
            }
          }
        }

        let toString = Function.prototype.toString;
        let strVal;
        if (!original) {
          original = propDef && propDes ? propDes[getOrSet] : defineAs && targetObject[defineAs];
        }
        if (!original) {
          // It seems to be a brand new function, rather than a replacement.
          // Let's ensure it appears as a native one with little hack: we proxy a Promise callback ;)
          Promise.resolve(new Promise(resolve => original = resolve));
          let name = propDef && propDes ? `${getOrSet} ${propName}` : defineAs;
          if (name) {
            let nameDef = Reflect.getOwnPropertyDescriptor(original, "name");
            nameDef.value = name;
            Reflect.defineProperty(original, "name", nameDef);
            strVal = toString.call(original).replace(/^function \(\)/, `function ${name}()`)
          }
        }

        strVal = strVal || toString.call(original);

        let proxy = new Proxy(original, {
          apply(target, thisArg, args) {
            return func.apply(thisArg, args);
          }
        });

        if (!exportFunction._toStringMap) {
          let map = new WeakMap();
          exportFunction._toStringMap = map;
          let toStringProxy = new Proxy(toString, {
            apply(target, thisArg, args) {
              return map.has(thisArg) ? map.get(thisArg) : Reflect.apply(target, thisArg, args);
            }
          });
          map.set(toStringProxy, toString.apply(toString));
          Function.prototype.toString = toStringProxy;
        }
        exportFunction._toStringMap.set(proxy, strVal);

        if (propName) {
          if (!propDes) {
            targetObject[propName] = proxy;
          } else {
            if (getOrSet) {
              propDes[getOrSet] = proxy;
            } else {
              if ("value" in propDes) {
                propDes.value = proxy;
              } else {
                return exportFunction(() => proxy, targetObject, `get ${propName}`);
              }
            }
            Object.defineProperty(targetObject, propName, propDes);
          }
        }
        return proxy;
      } catch (e) {
        console.error(e, `setting ${targetObject}.${defineAs || original}`, func);
      }
      return null;
    }),

    patchWindow(patchingCallback, env) {
      if (patchWindow.disabled) {
        return false;
      }
      patchWindow.callbacks ??= new WeakSet();
      if (patchWindow.callbacks.has(patchingCallback)) {
        return true;
      }
      patchWindow.callbacks.add(patchingCallback);

      env ??= {};
      const patchedWindows = new WeakSet(); // track them to avoid indirect recursion

      // win: window object to modify.
      function modifyWindow(win) {
        try {
          const unwrappedWindow = xray.unwrap(win);
          const window = xray.wrap(unwrappedWindow);
          const Proxy = window.Proxy;
          env.xray = Object.assign({ window }, xray);
          env.xray.proxify =
            (propName, handler, scope = window) =>
              xray.unwrap(scope)[propName] =
                new Proxy(xray.unwrap(scope[propName]), xray.forPage(handler));

          if (patchedWindows.has(unwrappedWindow)) return;
          patchedWindows.add(unwrappedWindow);
          patchingCallback(unwrappedWindow, env);
          modifyWindowOpenMethod(unwrappedWindow);
          modifyFramingElements(unwrappedWindow);
          // we don't need to modify win.opener, read skriptimaahinen notes
          // at https://forums.informaction.com/viewtopic.php?p=103754#p103754
        } catch (e) {
          if (e instanceof DOMException && e.name === "SecurityError") {
            // In case someone tries to access SOP restricted window.
            // We can just ignore this.
          } else throw e;
        }
      }

      function modifyWindowOpenMethod(win) {
        const windowOpen = win.open;
        exportFunction(function(...args) {
          const newWin = windowOpen.call(this, ...args);
          if (newWin) modifyWindow(newWin);
          return newWin;
        }, win, {defineAs: "open"});
      }

      function modifyFramingElements(win) {
        for (const property of ["contentWindow", "contentDocument"]) {
          for (const iface of ["Frame", "IFrame", "Object"]) {
            const proto = win[`HTML${iface}Element`].prototype;
            modifyContentProperties(proto, property)
          }
        }
        // auto-trigger window patching whenever new elements are added to the DOM
        const patchAll = () => {
          if (patchWindow.disabled) {
            console.debug("patchWindow disabled: disconnecting MutationObserver."); // DEV_ONLY
            observer.disconnect();
          }
          for (let j = 0; j in window; j++) {
            try {
              modifyWindow(window[j]);
            } catch (e) {
              console.error(e, `Patching frames[${j}]`);
            }
          }
        };

        const xrayWin = xray.wrap(win);
        const observer = new MutationObserver(patchAll);
        observer.observe(win.document, { subtree: true, childList: true });
        const patchHandler = {
          apply(target, thisArg, args) {
            const ret = Reflect.apply(target, thisArg, args);
            const wrapped = thisArg && xray.wrap(thisArg);
            if (wrapped) {
              try {
                if ((wrapped.ownerDocument || wrapped) === xrayWin.document) {
                  patchAll();
                }
              } catch (e) {
                console.error("Can't propagate patches (likely SOP violation).", e, thisArg, wrapped, location); // DEV_ONLY
              }
            }
            try {
              return ret ? xray.forPage(ret, win) : ret;
            } catch (e) {
              console.error("Can't wrap return value.", e, thisArg, target, args, ret, location); // DEV_ONLY
            }
            return ret;
          }
        };

        const domChangers = {
          Element: [
            "set innerHTML", "set outerHTML",
            "after", "append", "appendChild",
            "before",
            "insertAdjacentElement", "insertAdjacentHTML", "insertBefore",
            "prepend",
            "replaceChildren", "replaceWith", "replaceChild",
            "setHTML",
          ],
          Document: [
            "append", "prepend", "replaceChildren",
            "write", "writeln",
          ]
        };

        function patch(proto, method) {
          let accessor;
          if (method.startsWith("set ")) {
            accessor = "set";
            method = method.replace("set ", "");
          } else {
            accessor = "value";
          }
          if (!(method in proto)) return;
          while (!proto.hasOwnProperty(method)) {
            proto = Object.getPrototypeOf(proto);
            if (!proto) {
              console.error(`Couldn't find property ${method} on the prototype chain!`);
              return;
            }
          }
          const des = xray.getSafeDescriptor(proto, method, accessor);
          des[accessor] = exportFunction(new Proxy(des[accessor], patchHandler), proto, {defineAs: `${accessor} ${method}`});;
          Reflect.defineProperty(xray.unwrap(proto), method, des);
        }

        for (const [obj, methods] of Object.entries(domChangers)) {
          const proto = win[obj].prototype;
          for (const method of methods) {
            patch(proto, method);
          }
        }
        if (patchWindow.onObject) patchWindow.onObject.add(patchAll);
      }

      function modifyContentProperties(proto, property) {
        let descriptor = xray.getSafeDescriptor(proto, property, "get");
        let origGetter = descriptor.get;
        let replacements = {
          contentWindow() {
            let win = origGetter.call(this);
            if (win) modifyWindow(win);
            return win;
          },
          contentDocument() {
            let document = origGetter.call(this);
            if (document && document.defaultView) modifyWindow(document.defaultView);
            return document;
          }
        };

        descriptor.get = exportFunction(replacements[property], proto, {defineAs: `get ${property}`});
        Reflect.defineProperty(proto, property, descriptor);
      }

      modifyWindow(window);

      return true;
    }
  }));

  if (xray.enabled) {
    // make up for object element initialization inconsistencies on Firefox
    let callbacks = new Set();
    patchWindow.onObject = {
      add(callback) {
        callbacks.add(callback);
      },
      fire() {
        for (let callback of [...callbacks]) {
          callback();
        }
      }
    };

    const eventId = "__nscl_patchWindow_onObject__";
    const intercepted = new WeakSet();
    addEventListener(eventId, e => {
      let {target} = e;
      if (target instanceof HTMLObjectElement &&
        target.contentWindow &&
        !intercepted.has(target.contentWindow)) {
        intercepted.add(target.contentWindow);
        e.stopImmediatePropagation();
        patchWindow.onObject.fire();
      }
    }, true);

    if (frameElement instanceof HTMLObjectElement) {
      frameElement.dispatchEvent(new CustomEvent(eventId));
    }
  }

  Object.defineProperty(patchWindow, "disabled", {
    get() {
      if (typeof ns === "object" && ns) {
        if (ns.allows && ns.policy) {
          const value = !ns.allows("script");
          Object.defineProperty(patchWindow, "disabled", { value, configurable: true });
          return value;
        }
        if (typeof ns.on === "function") {
          ns.on("capabilities", () => {
            if (ns.allows) {
              this.disabled;
            }
          });
        }
      }
      return false;
    },
    set(value) {
      Object.defineProperty(patchWindow, "disabled", { value, configurable: true });
      return value;
    },
    configurable: true,
  });
}
