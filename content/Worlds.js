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
  const MY_ID = "__WorldsHelperPort__";
  const ports = new Map();

  const { dispatchEvent, addEventListener, removeEventListener } = self;

  const WORLD_NAMES = ["MAIN", "ISOLATED"];
  const [here, there] = self?.browser?.runtime ? WORLD_NAMES.reverse() : WORLD_NAMES;

  function Port(portId, scriptId = "") {
    this.id = portId ??= `${MY_ID}:${scriptId}:${uuid()}`;
    console.debug(`Creating ${here}->${there} ${portId}`); // DEV_ONLY

    // we need a double dispatching dance and maintaining a stack of
    // return values / thrown errors because Chromium seals the detail object
    // (on Firefox we could just append further properties to it...)
    const retStack = [];

    let fire = (e, detail, target = self) => {
      dispatchEvent.call(target, new CustomEvent(`${portId}:${e}`, {detail, composed: true}));
    }

    this.postMessage = function(msg, target = self) {
      retStack.push({});
      let detail = {msg};
      fire(there, detail, target);
      let ret = retStack.pop();
      if (ret.error) throw ret.error;
      return ret.value;
    };

    const listeners = {
      [`${portId}:${here}`]: event => {
        if (typeof this.onConnect === "function" && !this.connected) {
          this.connected = true;
          try {
            this.onConnect(this);
          } catch (error) {
            console.error(error);
          }
        }
        if (typeof this.onMessage === "function" && event.detail) {
          let ret = {};
          try {
            ret.value = this.onMessage(event.detail.msg, event);
          } catch (error) {
            ret.error = error;
          }
          fire(`return:${there}`, ret);
        }
      },

      [`${portId}:return:${here}`]:  event => {
        let {detail} = event;
        if (detail && retStack.length) {
         retStack[retStack.length -1] = detail;
        }
      },
    }

    for (let [name, handler] of Object.entries(listeners)) {
      addEventListener.call(self, name, handler, true);
    }

    const NOP = () => {};

    this.dispose = () => {
      fire = NOP;
      this.onConnect = this.onMessage = null;
      this.connected = false;
      for (let [name, handler] of Object.entries(listeners)) {
        removeEventListener.call(self, name, handler, true);
      }
      this.disposed = true;
    }

    this.onConnect = this.onMessage = null;
    this.connected = false;
    this.disposed = false;

    this.mergeHandlers = function(handlers) {
      if (!handlers) return;
      this.onMessage = handlers.onMessage || NOP;
      this.onConnect = handlers.onConnect || NOP;
    }
  }

  const Worlds = {
    connect(scriptId, handlers) {
      let port = ports.get(scriptId);
      if (port) {
        port.mergeHandlers(handlers);
        if (port.onConnect) {
          if (!port.connected) {
            port.connected = true;
            try {
              port.onConnect(port);
            } catch(e) {
              console.error(e);
            }
          }
          if (!(ports.values().some(p => !p.connected))) {
            this.dispose();
          }
          return port;
        }
      }

      const portId = myPort.postMessage({id: "connect", scriptId})
      port ||= new Port(portId, scriptId);
      ports.set(scriptId, port);
      port.mergeHandlers(handlers);

      if (portId && port.onMessage) {
        myPort.postMessage({id: "ready", scriptId});
        this.connect(scriptId);
      }
      return port;
    },
    dispose() {
      myPort.postMessage({id: "dispose"});
      myPort.dispose();
      if (globalThis.Worlds === this) {
        delete globalThis.Worlds;
        console.debug(`Disposed ${here} Worlds`, document.documentElement.outerHTML); // DEV_ONLY
      }
    }
  };

  const myPort = new Port(MY_ID);
  let bootstrapped = false;
  myPort.onMessage = (msg => {
    console.debug(`${here} got message`, msg);
    switch(msg.id) {
      case "dispose":
        myPort.dispose(); // prevent infinite message loop
        Worlds.dispose();
        break;
      case "connect":
        return ports.get(msg.scriptId)?.id;
      case "ready":
        return Worlds.connect(msg.scriptId).id;
      case "bootstrap":
        if (bootstrapped) return;
        bootstrapped = true;
        return {
          ports: [...ports].map(([scriptId, port]) => [scriptId, port.id]),
        };
    }
  });

  {
    const bootstrap = myPort.postMessage({id: "bootstrap"});
    if (bootstrap?.ports) {
      for(const [scriptId, portId] of bootstrap.ports) {
        console.debug(`${here} got ${scriptId} ${portId} as bootstrap`); // DEV_ONLY
        ports.set(scriptId, new Port(portId, scriptId));
      }
    }
  }

  Object.freeze(Worlds);

  // safety net, dispose before any page script can run
  const observer = new MutationObserver(function() {
    this.disconnect();
    Worlds.dispose();
  });
  observer.observe(document.documentElement, {
    childList: true,
  });

  return Worlds;
})();
