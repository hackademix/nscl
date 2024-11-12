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

globalThis.Worlds ||= (() => {

  const pristine = originalObj =>
    Object.fromEntries(Object.entries(originalObj)
      .map(([n, v]) => v.bind ? [n, v.bind(originalObj)] : [n,v]));

  const console = pristine(globalThis.console);

  const WORLDS_ID = "__WorldsHelperPort__";
  const ports = new Map();

  const { dispatchEvent, addEventListener, removeEventListener } = self;

  const WORLD_NAMES = ["MAIN", "ISOLATED"];
  const [here, there] = self?.browser?.runtime ? WORLD_NAMES.reverse() : WORLD_NAMES;

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
        fire = NOP;
        this.onConnect = this.onMessage = null;
        this.connected = false;
        for (let [name, handler] of Object.entries(listeners)) {
          removeEventListener.call(self, name, handler, true);
        }
        this.disposed = true;
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
  }

  const Worlds = {
    connect(scriptId, handlers, portId) {
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
          }) === port.id)
      ) {
        port.connect();
        if (!ports.values().some(p => !p.connected)) {
          this.dispose();
        }
      }

      return port;
    },
    dispose() {
      worldsPort.postMessage({id: "dispose"});
      worldsPort.dispose();
      if (globalThis.Worlds === this) {
        delete globalThis.Worlds;
        console.debug(`Disposed ${here} Worlds`, document.documentElement.outerHTML); // DEV_ONLY
      }
    },
    main: {
      console,
      pristine,
    },
  };

  const worldsPort = new Port(WORLDS_ID);
  let bootstrapped = false;
  worldsPort.onMessage = (msg => {
    console.debug(`${here} got message`, msg);
    switch(msg.id) {
      case "dispose":
        worldsPort.dispose(); // prevent infinite message loop
        Worlds.dispose();
        break;
      case "connect":
        return ports.get(msg.scriptId)?.id;
      case "ready":
        return Worlds.connect(msg.scriptId, null, msg.portId).id;
      case "bootstrap":
        if (bootstrapped) return;
        bootstrapped = true;
        return {
          ports: [...ports].map(([scriptId, port]) => [scriptId, port.id]),
        };
    }
  });

  {
    const bootstrap = worldsPort.postMessage({id: "bootstrap"});
    if (bootstrap?.ports) {
      for(const [scriptId, portId] of bootstrap.ports) {
        console.debug(`${here} got ${scriptId} ${portId} as bootstrap`); // DEV_ONLY
        ports.set(scriptId, new Port(portId, scriptId));
      }
    }
  }

  // just in case, dispose before any page script can run
  setTimeout(() => Worlds.dispose(), 0);

  return Object.freeze(Worlds);
})();
