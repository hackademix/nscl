/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2023 Giorgio Maone <https://maone.net>
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
  const allHandlers = new Set();
  const namespacedHandlers = new Map();

  let dispatch = (msg, sender) => {
    let {__meta, _messageName} = msg;
    if (!__meta) {
      // legacy message from embedder or library? ignore it
      if (!_messageName) {
        debug(`Message not in NSCL-specific format: %s`, JSON.stringify(msg));
        return undefined;
      }
      __meta = {name: _messageName};
    }
    delete msg.__meta;
    delete msg._messageName;
    let {name} = __meta;
    let handlers = allHandlers;
    let namespace = "";
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx > 0) {
      namespace = name.substring(0, dotIdx);
      if (namespacedHandlers.has(namespace)) {
        handlers = [namespacedHandlers.get(namespace)];
        name = name.substring(dotIdx + 1);
        namespace += ".";
      } else {
        namespace = "";
      }
    }
    let responderFound = false;
    let exception = null;
    for (let h of handlers) {
      if (typeof h !== "object") {
        // might be a namespace
        continue;
      }
      let f = h[name];
      if (typeof f === "function") {
        let result;
        try {
          result = f(msg, sender);
        } catch (e) {
          error(e);
          exception = e;
          continue;
        }
        if (typeof result === "undefined") {
          responderFound = true;
          continue;
        }
        return Promise.resolve(result);
      }
    }
    if (exception) throw exception;
    if (!responderFound) {
      debug("Warning: no handler for message %s%s %s in context %s", namespace, name, JSON.stringify(msg), document.URL);
    }
  };

  var Messages = {
    addHandler(handler, impl) {
      let originalSize = allHandlers.size;
      allHandlers.add(handler);
      if (typeof handler === "string") {
        namespacedHandlers.set(handler, impl || {});
      }
      if (originalSize === 0 && allHandlers.size === 1) {
        browser.runtime.onMessage.addListener(dispatch);
      }
    },
    removeHandler(handler) {
      let originalSize = allHandlers.size;
      allHandlers.delete(handler);
      if (typeof handler === "string") {
        namespacedHandlers.delete(handler);
      }
      if (originalSize === 1 && allHandlers.size === 0) {
        browser.runtime.onMessage.removeListener(dispatch);
      }
    },
    async send(name, args = {}, recipientInfo = null) {
      args.__meta = {name, recipientInfo};
      args._messageName = name; // legacy protocol, for embedders
      if (recipientInfo && "tabId" in recipientInfo) {
        let opts;
        if ("frameId" in recipientInfo) opts = {frameId: parseInt(recipientInfo.frameId)};
        return await browser.tabs.sendMessage(parseInt(recipientInfo.tabId), args, opts);
      }
      return await browser.runtime.sendMessage(args);
    },
    isMissingEndpoint(error) {
      return error && error.message ===
        "Could not establish connection. Receiving end does not exist.";
    }
  }
}
