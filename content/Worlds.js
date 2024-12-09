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
  const isMainWorld = !(globalThis.browser?.runtime);
  let ended = false;

  // unless we're on Gecko < 128, where MAIN world is not supported and we do everything through xray
  let splitWorlds = true;
  let worldsPort;

  const { dispatchEvent, addEventListener, removeEventListener, CustomEvent } = self;
  const { Object, Error, Reflect } = globalThis;

  const xray = (() => {
    const xrayEnabled = globalThis.XPCNativeWrapper;
    const zombieDanger = xrayEnabled && document.readyState === "complete";
    const isZombieException = e => e.message.includes("dead object");

    const getSafeMethod = zombieDanger
    ? (obj, method, wrappedObj) => {
      let actualTarget = obj[method];
      return XPCNativeWrapper.unwrap(new window.Proxy(actualTarget, cloneInto({
        apply(targetFunc, thisArg, args) {
          try {
            return actualTarget.apply(thisArg, args);
          } catch (e) {
            if (isZombieException(e)) {
              console.debug(`Zombie hit for "${method}", falling back to native wrapper...`);
              return (actualTarget = (wrappedObj || XPCNativeWrapper(obj))[method]).apply(thisArg, args);
            }
            throw e;
          }
        },
      }, window, {cloneFunctions: true, wrapReflectors: true}
      )));
    }
    : (obj, method) => obj[method];

    const getSafeDescriptor = (proto, prop, accessor) => {
      const des = Reflect.getOwnPropertyDescriptor(proto, prop);
      if (zombieDanger) {
        const wrappedDescriptor =  Reflect.getOwnPropertyDescriptor(xray.wrap(proto), prop);
        des[accessor] = getSafeMethod(des, accessor, wrappedDescriptor);
      }
      return des;
    };

    const xrayMake = (enabled, wrap, unwrap = wrap, forPage = wrap) => ({
      enabled, wrap, unwrap, forPage,
      getSafeMethod, getSafeDescriptor
    });

    return !xrayEnabled
    ? xrayMake(false, o => o)
    : xrayMake(true, o => XPCNativeWrapper(o), o => XPCNativeWrapper.unwrap(o),
      function(obj, win = this.window || window) {
        return cloneInto(obj, win, {cloneFunctions: true, wrapReflectors: true});
      });
  })();

  const getStack = (() => {
    if ("stackTraceLimit" in Error) {
      // Prevent V8's flexibility to get in the way
      const invariants = ["stackTraceLimit", "prepareStackTrace"];
      Error.stackTraceLimit = 10;
      delete Error.prepareStackTrace;
      const replay = [];
      const backup = Object.assign({}, Error);
      const ifSafe = (key, doIt) => {
        if (ended || !invariants.includes(key)) {
          return doIt();
        }
        replay.push(doIt);
        return doIt(backup);
      };

      const handler = {
        get(target, key, receiver) {
          if (ended) {
            for (const doIt of replay) {
              try {
                doIt();
              } catch (e) {}
            }
            replay.length = 0;
          } else if (invariants.includes(key)) {
            return backup[key];
          }
          return Reflect.get(target, key, receiver);
        }
      };
      for (const trap of ["set", "deleteProperty", "defineProperty"]) {
        handler[trap] = (target, key, ...args) =>
          ifSafe(key, (obj = target) => Reflect[trap](obj, key, ...args));
      }

      globalThis.Error = new Proxy(Error, handler);
    }
    const stackGetter = Object.getOwnPropertyDescriptor(Error.prototype, "stack")?.get
      || function() { return this.stack };
    return () => {
      const stack = Reflect.apply(stackGetter, new Error(), []).split("\n");
      // Remove top "Error" (Chromium-only) and this very  call site
      stack.splice(0, stack[0].startsWith("Error") ? 2 : 1);
      return stack;
    }
  })();

  const pristine = originalObj =>
    Object.fromEntries(Object.entries(originalObj)
      .map(([n, v]) => v.bind ? [n, v.bind(originalObj)] : [n,v]));

  const console = pristine(globalThis.console);

  const WORLDS_ID = "__WorldsHelperPort__";
  const ports = new Map();

  const WORLD_NAMES = ["MAIN", "ISOLATED"];
  const url = location.href;
  const here = `${WORLD_NAMES[isMainWorld ? 0 : 1]}@${url}`;

  class Port {
    static match(scriptId) {
      return ports.get(scriptId?.endsWith(".main") ? scriptId.slice(0, -5) : scriptId);
    }

    static createMatching(scriptId, handlers) {
      const other = Port.match(scriptId);
      const matching = new Port(other?.id, scriptId);
      if (matching.mergeHandlers(handlers) && other) {
        matching.connect();
        other.connect();
      }
      return matching;
    }

    constructor(portId, scriptId = "") {
      let [here, there] = WORLD_NAMES;
      if (scriptId?.endsWith(".main")) {
        scriptId = scriptId.slice(0, -5); // drop the ".main" suffix
      } else if (!isMainWorld) {
        [here, there] = [there, here];
      }

      this.id = portId ??= `${WORLDS_ID}:${scriptId}:${uuid()}`;
      ports.set(scriptId, this);
      console.debug(`Creating ${here}->${there} ${portId} - ${url}`); // DEV_ONLY

      // we need a double dispatching dance and maintaining a stack of
      // return values / thrown errors because Chromium seals the detail object
      // (on Firefox we could just append further properties to it...)
      const retStack = [];

      let fire = (e, detail, target = self) => {
        detail = xray.forPage(detail);
        dispatchEvent.call(target, new CustomEvent(`${portId}:${e}`, { detail, composed: true }));
      };

      this.postMessage = function (msg, target = self) {
        retStack.push({});
        let detail = { msg };
        fire(there, detail, target);
        let ret = retStack.pop();
        if (ret.error) throw ret.error;
        return ret.value;
      };

      const listeners = {
        [`${portId}:${here}`]: event => {
          this.connect();
          if (typeof this.onMessage === "function" && event.detail) {
            let ret = {};
            try {
              ret.value = this.onMessage(event.detail.msg, {
                port: this,
                event,
              });
            } catch (error) {
              ret.error = error;
            }
            fire(`return:${there}`, ret);
          }
        },

        [`${portId}:return:${here}`]: event => {
          let { detail } = event;
          if (detail && retStack.length) {
            retStack[retStack.length - 1] = detail;
          }
        },
      };

      for (let [name, handler] of Object.entries(listeners)) {
        addEventListener.call(self, name, handler, true);
      }

      const NOP = () => { };

      this.dispose = () => {
        if (this.disposed) return;
        this.disposed = true;
        fire = NOP;
        this.onConnect = this.onMessage = null;
        for (let [name, handler] of Object.entries(listeners)) {
          removeEventListener.call(self, name, handler, true);
        }
        console.debug(`Disposed ${this}`); // DEV_ONLY
      };

      this.onConnect = this.onMessage = null;
      this.connected = false;
      this.disposed = false;

      this.mergeHandlers = function (handlers) {
        if (!handlers) {
          return !!(this.onMessage && this.onConnect);
        }
        this.onMessage = handlers.onMessage || NOP;
        this.onConnect = handlers.onConnect || NOP;
        return true;
      };
    }

    connect(handlers) {
      if (handlers) {
        this.mergeHandlers(handlers);
      }
      if (typeof this.onConnect === "function" && !this.connected) {
        this.connected = true;
        try {
          this.onConnect(this);
        } catch (error) {
          console.error(error);
        }
        return true;
      }
      return false;
    }

    toString() {
      return `port ${this.id}@${here}}`;
    }
  }

  const connectWorlds = (scriptId, handlers, portId) => {
    let port = Port.match(scriptId);

    const isReady = !!portId;
    if (!port) {
      portId ??= worldsPort.postMessage({id: "connect", scriptId})
      port = new Port(portId, scriptId);
    }

    if (
      port.mergeHandlers(handlers) &&
      (isReady ||
        worldsPort.postMessage({
          id: "ready",
          scriptId,
          portId: port.id,
        })?.canHandle)
    ) {
      port.connect();
      queueMicrotask(endWorldsIfDone);
    }

    return port;
  };

  const endWorlds = () => {
    if (!worldsPort) return; // splitWorlds = false
    worldsPort.postMessage({id: "end"});
    worldsPort.dispose();
    ended = true;
    if (globalThis.Worlds?.end === Worlds.end) {
      delete globalThis.Worlds;
      console.debug(`End of the ${here} World connector.`, document.documentElement.outerHTML); // DEV_ONLY
    }
  };

  const endWorldsIfDone = () => {
    if (![...ports.values()].some(p => !(p?.connected))) {
      endWorlds();
    }
  };

  const Worlds = {
    connect(scriptId, handlers) {
      if (!handlers && typeof(scriptId) == "object") {
        // on Chromium we can try to infer the scriptId from the stack.
        handlers = scriptId;
        const stack = getStack();
        const scriptMatch = stack[1]?.match(/\/([\w.]+).js\b/);
        scriptId = scriptMatch && scriptMatch[1];
      }
      if (scriptId) {
        return splitWorlds
          ? connectWorlds(scriptId, handlers)
          : Port.createMatching(scriptId, handlers)
          ;
      }
      throw new Error(`Can't identify scripts to connect on the stack ${stack.join("\n")}. Is this Gecko?`);
    },
    main: {
      console,
      pristine,
      xray,
    },
  };

  Object.freeze(Worlds);

  if (isMainWorld) {
    const url = document.URL;
    // proxy the API to validate access (allow only from the same extension)
    let validatingStack = false;
    const validateStack = () => {
      if (worldsPort?.disposed || validatingStack) return;
      validatingStack = true;
      try {
        const stack = getStack();

        // stack items are:
        // [0] -> validateStack() itself
        // [1] -> the callee, function / accessor to be "protected"
        // [2] -> the caller to be validated (same origin as the extension)
        let [myself, callee, caller = "UNKNOWN CALL SITE"] = stack;

        console.debug(`Validating stack in ${url}`, stack); // DEV_ONLY
        const parseOrigin = l => l.replace(/^\s*(?:at )?(?:.*[(@])?([\w-]+:\/\/[^/]+\/|<[^>]+>).*/, "$1");

        const myOrigin = parseOrigin(myself);
        if (!myOrigin)  {
          throw new Error(`Cannot find Worlds' origin from ${myself}`);
        }
        if (parseOrigin(callee) !== myOrigin) {
          throw(`Callee ${callee} doesn't match origin ${myOrigin}!`);
        }
        // note: even if on Gecko myOrigin may be "<anonymous code>" instead of extension URL,
        // a content caller can't fake it via "// #sourceURL=" because space chars breaks it
        if (parseOrigin(caller) !== myOrigin) {
          throw new Error(`Unsafe call to ${myOrigin} from ${caller} (${url}, <STACK>\n${stack.join("\n")}\n</STACK>)`);
        }
      } catch (e) {
        endWorldsIfDone();
        throw e;
      } finally {
        validatingStack = false;
      }
    }

    const safeWorlds = new Proxy(Worlds, {
      get(src, key) {
        validateStack();
        return src[key];
      },
    });
    Object.defineProperty(globalThis, "Worlds", {
      configurable: true,
      get() {
        try {
          validateStack();
        } catch (e) {
          console.error(e);
          return;
        }
        return safeWorlds;
      },
      set(v) {
        delete this.Worlds;
        endWorldsIfDone();
        return this.Worlds = v;
      }
    });

  } else {
    globalThis.Worlds = Worlds;
    // fetch connectable script IDs from manifest
    browser.runtime.getManifest()
      .content_scripts.filter(cs => cs.world === "MAIN")
      .map(cs => cs.js.map(js => js.match(/\/(\w+)\.main\.js\b/))
      .filter(m => m).forEach(([m, scriptId]) => {
        if (!ports.has(scriptId)) {
          ports.set(scriptId, null);
        }
      }));
    splitWorlds = ports.size > 0;
  }

  if (splitWorlds) {
    let bootstrapped = false;
    worldsPort = new Port(WORLDS_ID, "Worlds");

    worldsPort.connect({
      onMessage(msg) {
        console.debug(`${here} got message`, msg);
        switch(msg.id) {
          case "end":
            worldsPort.dispose(); // prevent infinite message loop
            endWorldsIfDone();
            break;
          case "connect":
            return Port.match(msg.scriptId)?.id;
          case "ready":
            const port = connectWorlds(msg.scriptId, null, msg.portId);
            return { canHandle: !!(port.onMessage || port.onConnect) };
          case "bootstrap":
            if (bootstrapped) return;
            bootstrapped = true;
            // Switch to random portId after initial handshake, before page scripts can run
            const swapPort = new Port(null, "Worlds");
            swapPort.mergeHandlers(worldsPort);
            queueMicrotask(() => {
              worldsPort.dispose();
              worldsPort = swapPort;
            });
            return {
              ports: [...ports].map(([scriptId, port]) => [scriptId, port?.id]),
              swapPortId: swapPort.id,
            };
        }
      }
    });

    const bootstrap = worldsPort.postMessage({id: "bootstrap"});
    if (bootstrap?.ports) {
      for(const [scriptId, portId] of bootstrap.ports) {
        console.debug(`${here} got ${scriptId} ${portId} as bootstrap`); // DEV_ONLY
        ports.set(scriptId, portId ? new Port(portId, scriptId) : null);
      }
    }
    if (bootstrap?.swapPortId) {
      // Switch to random portId after initial handshake, before page scripts can run
      const swapPort = new Port(bootstrap.swapPortId, "Worlds");
      swapPort.mergeHandlers(worldsPort);
      worldsPort.dispose();
      worldsPort = swapPort;
    }
  }
  // just in case, end the Worlds before any page script can run
  setTimeout(function justInCase() {
    endWorldsIfDone();
    if(document.readyState == "loading") {
      setTimeout(justInCase, 0);
    }
  }, 0);
}
