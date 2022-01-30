/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2021 Giorgio Maone <https://maone.net>
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

// depends on /nscl/common/uuid.js

"use strict";
/**
 * Injects code into page context in a cross-browser way, providing it
 * with tools to wrap/patch the DOM and the JavaScript environment
 * and propagating the changes to child windows created on the fly in order
 * to prevent the modifications to be cancelled by hostile code.
 *
 * @param {function} patchingCallback
 *        the (semi)privileged wrapping code to be injected.
 *        Warning: this is not to be considered a closure, since Chromium
 *        injection needs it to be reparsed out of context.
 *        Use the env argument to propagate parameters.
 *        It will be called as patchingCallback(unwrappedWindow, env).
 * @param {object} env
 *        a JSON-serializable object to made available to patchingCallback as
 *        its second argument. It gets augmented by two additional properties:
 *        1. a Port (port: {postMessage(), onMessage()}) object
 *           allowing the injected script to communicate with
 *           the privileged content script by calling  port.postMessage(msg, [event])
 *           and/or by listening to a port.onMessage(msg, event) user-defined callback.
 *        2. A "xray" object property to help handling
 *           Firefox's XRAY wrappers.
 *           xray: {
 *             enabled: true, // false on Chromium
 *             unwrap(obj), // returns the XPC-wrapped object - or just obj on Chromium
 *             wrap(obj), // returns the XPC wrapper around the object - or just obj on Chromium
 *             forPage(obj), // returns cloneInto(obj) including functions and DOM objects - or just obj on Chromium
 *             window, // the XPC-wrapped version of unwrappedWindow, or unwrappedWindow itself on Chromium
 *           }
 * @returns {object} port
 *        A Port object allowing the privileged content script to communicate
 *        with the injected script on the page by calling port.postMessage(msg, [event])
 *        and/or by listening to a port.onMessage(msg, event) user-defined callback.
 */

function patchWindow(patchingCallback, env = {}) {
  if (typeof patchingCallback !== "function") {
    patchingCallback = new Function("unwrappedWindow", "env", patchingCallback);
  }
  let eventId = this && this.eventId || `windowPatchMessages:${uuid()}`;
  let { dispatchEvent, addEventListener } = window;

  function Port(from, to) {
    // we need a double dispatching dance and maintaining a stack of
    // return values / thrown errors because Chromium seals the detail object
    // (on Firefox we could just append further properties to it...)
    let retStack = [];

    function fire(e, detail, target = window) {
      dispatchEvent.call(target, new CustomEvent(`${eventId}:${e}`, {detail, composed: true}));
    }
    this.postMessage = function(msg, target = window) {
      retStack.push({});
      let detail = {msg};
      fire(to, detail, target);
      let ret = retStack.pop();
      if (ret.error) throw ret.error;
      return ret.value;
    };
    addEventListener.call(window, `${eventId}:${from}`, event => {
      if (typeof this.onMessage === "function" && event.detail) {
        let ret = {};
        try {
          ret.value = this.onMessage(event.detail.msg, event);
        } catch (error) {
          ret.error = error;
        }
        fire(`return:${to}`, ret);
      }
    }, true);
    addEventListener.call(window, `${eventId}:return:${from}`, event => {
      let {detail} = event;
      if (detail && retStack.length) {
       retStack[retStack.length -1] = detail;
      }
    }, true);
    this.onMessage = null;
  }
  let port = new Port("extension", "page");

  let nativeExport = this && this.exportFunction || typeof exportFunction == "function";
  if (!nativeExport) {
    // Chromium
    let exportFunction = (func, targetObject, {defineAs, original} = {}) => {
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
    };
    let cloneInto = (obj, targetObject) => {
      return obj; // dummy for assignment
    };
    let script = document.createElement("script");
    script.text = `
    (() => {
      let patchWindow = ${patchWindow};
      let cloneInto = ${cloneInto};
      let exportFunction = ${exportFunction};
      let env = ${JSON.stringify(env)};
      let eventId = ${JSON.stringify(eventId)};
      env.port = new (${Port})("page", "extension");
      ({
        patchWindow,
        exportFunction,
        cloneInto,
        eventId,
      }).patchWindow(${patchingCallback}, env);
    })();
    `;
    document.documentElement.insertBefore(script, document.documentElement.firstChild);
    script.remove();
    return port;
  }

  env.port = new Port("page", "extension");

  function getSafeMethod(obj, method) {
    return isDeadTarget(obj, method) ? xray.wrap(obj)[method] : obj[method];
  }

  function getSafeDescriptor(proto, prop, accessor) {
    let des = Object.getOwnPropertyDescriptor(proto, prop);
    return isDeadTarget(des, accessor) ?
      Object.getOwnPropertyDescriptor(xray.wrap(proto), prop)
      : des;
  }

  let xrayMake = (enabled, wrap, unwrap = wrap, forPage = wrap) => ({
      enabled, wrap, unwrap, forPage,
      getSafeMethod, getSafeDescriptor
    });

  let xray = typeof XPCNativeWrapper === "undefined"
    ? xrayMake(false, o => o)
    : xrayMake(true, o => XPCNativeWrapper(o), o => XPCNativeWrapper.unwrap(o),
      function(obj, win = this.window || window) {
        return cloneInto(obj, win, {cloneFunctions: true, wrapReflectors: true});
      });

  var isDeadTarget = xray.enabled && document.readyState === "complete" ?
    (obj, method) => {
      // We may be repatching this already loaded window during an extension update:
      // beware of dead object from killed obsolete content script!
      try {
        obj[method].apply(null);
      } catch (e) {
        return e.message.includes("dead object");
      }
      return false;
    }
  : () => false;

  const patchedWindows = new WeakSet(); // track them to avoid indirect recursion

  // win: window object to modify.
  function modifyWindow(win) {
    try {
      win = xray.unwrap(win);
      env.xray = Object.assign({window: xray.wrap(win)}, xray);

      if (patchedWindows.has(win)) return;
      patchedWindows.add(win);
      patchingCallback(win, env);
      modifyWindowOpenMethod(win);
      modifyFramingElements(win);
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
    let windowOpen = win.open;
    exportFunction(function(...args) {
      let newWin = windowOpen.call(this, ...args);
      if (newWin) modifyWindow(newWin);
      return newWin;
    }, win, {defineAs: "open"});
  }

  function modifyFramingElements(win) {
    for (let property of ["contentWindow", "contentDocument"]) {
      for (let iface of ["Frame", "IFrame", "Object"]) {
        let proto = win[`HTML${iface}Element`].prototype;
        modifyContentProperties(proto, property)
      }
    }
    // auto-trigger window patching whenever new elements are added to the DOM
    let patchAll = () => {
      for (let j = 0; j in win; j++) {
        try {
          modifyWindow(win[j]);
        } catch (e) {
          console.error(e, `Patching frames[${j}]`);
        }
      }
    };

    let xrayWin = xray.wrap(win);
    let observer = new MutationObserver(patchAll);
    observer.observe(win.document, { subtree: true, childList: true });
    let patchHandler = {
      apply(target, thisArg, args) {
        let ret = Reflect.apply(target, thisArg, args);
        thisArg = thisArg && xray.wrap(thisArg);
        if (thisArg) {
          thisArg = xray.wrap(thisArg);
          if ((thisArg.ownerDocument || thisArg) === xrayWin.document) {
            patchAll();
          }
        }
        return ret ? xray.forPage(ret, win) : ret;
      }
    };

    let domChangers = {
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
      let des = getSafeDescriptor(proto, method, accessor);
      des[accessor] = new Proxy(des[accessor], patchHandler);
      win.Object.defineProperty(proto, method, xray.forPage(des, win));
    }

    for (let [obj, methods] of Object.entries(domChangers)) {
      let proto = win[obj].prototype;
      for (let method of methods) {
        patch(proto, method);
      }
    }
    if (patchWindow.onObject) patchWindow.onObject.add(patchAll);
  }

  function modifyContentProperties(proto, property) {
    let descriptor = getSafeDescriptor(proto, property, "get");
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
    Object.defineProperty(proto, property, descriptor);
  }

  modifyWindow(window);
  return port;
}

if (typeof XPCNativeWrapper !== "undefined") {
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