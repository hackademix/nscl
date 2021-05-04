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
 *        its second argument*
 * @returns {object} port
 *        A Port object to be used to communicate with the privileged content
 *        script, by using port.postMessage(msg, [event]) and
 *        the port.onMessage(msg, event) user-defined callback.
 */

function patchWindow(patchingCallback, env = {}) {
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
    let exportFunction = (func, targetObject, {defineAs}) => {
      try {
        let  [propDef, getOrSet, propName] = /^([gs]et)(?:\s+(\w+))$/.exec(defineAs) || [null, null, defineAs];
        let propDes = Object.getOwnPropertyDescriptor(targetObject, propName);
        let original = propDef && propDef ? propDes[getOrSet] : targetObject[defineAs];

        let proxy = new Proxy(original, {
          apply(target, thisArg, args) {
            return func.apply(thisArg, args);
          }
        });
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
        return proxy;
      } catch (e) {
        console.error(e, `setting ${targetObject}.${defineAs}`, func);
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
  // win: window object to modify.
  // modifyTarget: callback to function that modifies the desired properties
  //                or methods. Callback must take target window as argument.
  function modifyWindow(win, modifyTarget) {
    try {
      win = win.wrappedJSObject || win;
      modifyTarget(win, env);
      modifyWindowOpenMethod(win, modifyTarget);
      modifyFramingElements(win, modifyTarget);
      // we don't need to modify win.opener, read skriptimaahinen notes
      // at https://forums.informaction.com/viewtopic.php?p=103754#p103754
    } catch (e) {
      if (e instanceof DOMException && e.name === "SecurityError") {
        // In case someone tries to access SOP restricted window.
        // We can just ignore this.
      } else throw e;
    }
  }

  function modifyWindowOpenMethod(win, modifyTarget) {
    let windowOpen = win.open;
    exportFunction(function(...args) {
      let newWin = windowOpen.call(this, ...args);
      if (newWin) modifyWindow(newWin, modifyTarget);
      return newWin;
    }, win, {defineAs: "open"});
  }

  function modifyFramingElements(win, modifyTarget) {
    for (let property of ["contentWindow", "contentDocument"]) {
      for (let iface of ["Frame", "IFrame", "Object"]) {
        let proto = win[`HTML${iface}Element`].prototype;
        modifyContentProperties(proto, property, modifyTarget)
      }
    }
  }

  function modifyContentProperties(proto, property, modifyTarget) {
    let descriptor = Object.getOwnPropertyDescriptor(proto, property);
    let origGetter = descriptor.get;
    let replacementFn;

    if (property === "contentWindow") { replacementFn = function() {
      let win = origGetter.call(this);
      if (win) modifyWindow(win, modifyTarget);
      return win;
    }}
    if (property === "contentDocument") { replacementFn = function() {
      let document = origGetter.call(this);
      if (document && document.defaultView) modifyWindow(document.defaultView, modifyTarget);
      return document;
    }}

    descriptor.get = exportFunction(replacementFn, proto, {defineAs: `get ${property}`});
    Object.defineProperty(proto, property, descriptor);
  }

  modifyWindow(window, patchingCallback);
  return port;
}
