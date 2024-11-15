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
  const isMainWorld = !(self?.browser?.runtime);
  let ended = false;

  const { dispatchEvent, addEventListener, removeEventListener,
          Object, Error, Reflect } = self;

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
      stack.splice(0, 2); // Remove top "Error" and this very  call site
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
  const [here, there] = isMainWorld ? WORLD_NAMES : WORLD_NAMES.reverse();

  class Port {
    constructor(portId, scriptId = "") {
      this.id = portId ??= `${WORLDS_ID}:${scriptId}:${uuid()}`;
      console.debug(`Creating ${here}->${there} ${portId}`); // DEV_ONLY

      // we need a double dispatching dance and maintaining a stack of
      // return values / thrown errors because Chromium seals the detail object
      // (on Firefox we could just append further properties to it...)
      const retStack = [];

      let fire = (e, detail, target = self) => {
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
        this.connected = false;
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

    connect() {
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
    let port = ports.get(scriptId);

    const isReady = !!portId;
    if (!port) {
      portId ??= worldsPort.postMessage({id: "connect", scriptId})
      port = new Port(portId, scriptId);
      ports.set(scriptId, port);
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
      queueMicrotask(() => {
        if (!ports.values().some(p => !p)) {
          endWorlds();
        }
      });
    }

    return port;
  };

  const endWorlds = () => {
    worldsPort.postMessage({id: "end"});
    worldsPort.dispose();
    ended = true;
    if (globalThis.Worlds?.end === Worlds.end) {
      delete globalThis.Worlds;
      console.debug(`End of the ${here} World connector.`, document.documentElement.outerHTML); // DEV_ONLY
    }
  };

  const Worlds = {
    connect(handlers) {
      const scriptMatch = getStack()[1]?.match(/\/(\w+)(?:\.main)?\.js\b/);
      const scriptId = scriptMatch && scriptMatch[1];
      if (scriptId) {
        return connectWorlds(scriptId, handlers);
      }
      throw new Error(`Can't identify scripts to connect on the stack ${stack.join("\n")}`);
    },
    main: {
      console,
      pristine,
    },
  };

  let worldsPort = new Port(WORLDS_ID);
  let bootstrapped = false;
  worldsPort.onMessage = (msg => {
    console.debug(`${here} got message`, msg);
    switch(msg.id) {
      case "end":
        worldsPort.dispose(); // prevent infinite message loop
        endWorlds();
        break;
      case "connect":
        return ports.get(msg.scriptId)?.id;
      case "ready":
        const port = connectWorlds(msg.scriptId, null, msg.portId);
        return { canHandle: !!(port.onMessage || port.onConnect) };
      case "bootstrap":
        if (bootstrapped) return;
        bootstrapped = true;
        // Switch to random portId after initial handshake, before page scripts can run
        const swapPort = new Port(null, WORLDS_ID);
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
  });

  {
    const bootstrap = worldsPort.postMessage({id: "bootstrap"});
    if (bootstrap?.ports) {
      for(const [scriptId, portId] of bootstrap.ports) {
        console.debug(`${here} got ${scriptId} ${portId} as bootstrap`); // DEV_ONLY
        ports.set(scriptId, portId ? new Port(portId, scriptId) : null);
      }
    }
    if (bootstrap?.swapPortId) {
      // Switch to random portId after initial handshake, before page scripts can run
      const swapPort = new Port(bootstrap.swapPortId, WORLDS_ID);
      swapPort.mergeHandlers(worldsPort);
      worldsPort.dispose();
      worldsPort = swapPort;
    }
  }

  Object.freeze(Worlds);

  if (isMainWorld) {
     // proxy the API to validate access (allow only from the same extension)
    const validateStack = () => {
      if (worldsPort.disposed) return;
      try {
        const stack = getStack();
        console.debug("Validating stack", stack); // DEV_ONLY
        let parseOrigin = l => l.replace(/^\s*at (?:.*[(@])?([\w-]+:\/\/[^/]+\/).*/, "$1");
        let myOrigin;
        for (const line of stack) {
          if (!myOrigin) {
            if (line.includes("/Worlds.js")) {
              myOrigin ||= parseOrigin(line);
              if (!myOrigin) {
                // can't find my origin, panic!
                throw new Error(`Cannot find Worlds' origin: ${line}`);
              }
            }
            continue;
          }
          if (myOrigin !== parseOrigin(line)) {
            throw new Error(`Unsafe call to ${myOrigin} from ${line} (STACK ${stack.join("\n")} /STACK)`);
          }
        }
        // The whole call stack is same origin, everything's fine
      } catch (e) {
        endWorlds();
        throw e;
      }
    }

    const safeWorlds = new Proxy(Worlds, {
      get(src, key) {
        validateStack();
        const val = src[key];
        return val;
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
  }
  // just in case, end the Worlds before any page script can run
  setTimeout(endWorlds, 0);
}
