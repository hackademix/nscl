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

globalThis.WorldsHub ||= (() => {
  const MY_ID = "__WorldsHub__";
  const ports = new Map();

  const { dispatchEvent, addEventListener, removeEventListener } = self;
  const worlds = ["MAIN", "ISOLATED"];
  const [from, to] = self?.browser?.runtime ? worlds.reverse() : worlds;

  function Port(portId) {
    this.id = portId ??= `WorldHubsPort:${uuid()}`;
    console.debug(`Creating ${from}->${to} ${portId}`); // DEV_ONLY

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
      fire(to, detail, target);
      let ret = retStack.pop();
      if (ret.error) throw ret.error;
      return ret.value;
    };

    const listeners = {
      [`${portId}:${from}`]: event => {
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
          fire(`return:${to}`, ret);
        }
      },

      [`${portId}:return:${from}`]:  event => {
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

  const WorldsHub = {
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

      const portId = whPort.postMessage({id: "connect", scriptId})
      port ||= new Port(portId);
      ports.set(scriptId, port);
      port.mergeHandlers(handlers);

      if (portId && port.onMessage) {
        whPort.postMessage({id: "ready", scriptId});
        this.connect(scriptId);
      }
      return port;
    },
    dispose() {
      whPort.postMessage({id: "dispose"});
      whPort.dispose();
      if (globalThis.WorldsHub === this) {
        delete globalThis.WorldsHub;
        console.debug(`Disposed ${from} WorldsHub`, document.documentElement.outerHTML); // DEV_ONLY
      }
    }
  };

  const whPort = new Port(MY_ID);
  let bootstrapped = false;
  whPort.onMessage = (msg => {
    console.debug(`${from} got message`, msg);
    switch(msg.id) {
      case "dispose":
        whPort.dispose(); // prevent infinite message loop
        WorldsHub.dispose();
        break;
      case "connect":
        return ports.get(msg.scriptId)?.id;
      case "ready":
        return WorldsHub.connect(msg.scriptId).id;
      case "bootstrap":
        if (bootstrapped) return;
        bootstrapped = true;
        return {
          ports: [...ports].map(([scriptId, port]) => [scriptId, port.id]),
        };
    }
  });

  {
    const bootstrap = whPort.postMessage({id: "bootstrap"});
    if (bootstrap?.ports) {
      for(const [scriptId, portId] of bootstrap.ports) {
        console.debug(`${from} got ${scriptId} ${portId} as bootstrap`); // DEV_ONLY
        ports.set(scriptId, new Port(portId));
      }
    }
  }

  Object.freeze(WorldsHub);

  // safety net, dispose before any page script can run
  const observer = new MutationObserver(function() {
    this.disconnect();
    WorldsHub.dispose();
  });
  observer.observe(document.documentElement, {
    childList: true,
  });

  return WorldsHub;
})();
