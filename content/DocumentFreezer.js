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

'use strict'
var DocumentFreezer = (() => {

  const loaderAttributes = ["href", "src", "data"];
  const jsOrDataUrlRx = /^(?:data:(?:[^,;]*ml|unknown-content-type)|javascript:)/i;


  const lazy = {
    get eventTypes() {
      delete this.eventTypes;
      const elements = Object.getOwnPropertyNames(window)
        .filter(p => p.endsWith("Element")).map(p => window[p]);
      const eventTypes = new Set(["DOMContentLoaded"]);
      for (let e of elements) {
        if (!e) continue;
        for (let p of Object.getOwnPropertyNames(e.prototype)) {
          if (p.startsWith("on")) eventTypes.add(p.substring(2));
        }
      }
      return this.eventTypes = eventTypes;
    }
  };

  let firedDOMContentLoaded;
  function suppressEvents(e) {
    if (e.type === "DOMContentLoaded" && e.isTrusted) {
      firedDOMContentLoaded = true;
      return;
    }
    e.stopPropagation();
    console.debug(`Suppressing ${e.type} on `, e.target); // DEV_ONLY
  }

  function freezeAttributes(nodes = document.querySelectorAll("*")) {
    for (var el of nodes) {
      if ("_frozen" in el) {
        continue;
      }
      let content;
      const attributes = [];
      const loaders = [];
      for (let a of el.attributes) {
        let name = a.localName.toLowerCase();
        if (loaderAttributes.includes(name)) {
          if (jsOrDataUrlRx.test(a.value)) {
            loaders.push(a);
          }
        } else if (name.startsWith("on")) {
          console.debug("Removing", a, el.outerHTML); // DEV_ONLY
          attributes.push(a.cloneNode());
          a.value = "";
          el[name] = null;
        }
      }
      if (loaders.length) {
        for (let a of loaders) {
          attributes.push(a.cloneNode());
          a.value = "javascript://frozen";
        }
        if ("contentWindow" in el) {
          el.replaceWith(el = el.cloneNode(true));
        }
      }
      if (el.localName.toLowerCase() == "script") {
        suppressedScripts++;
        content = el.textContent;
        el.textContent = "";
      }
      if ((el._frozen = (content || attributes.length)
        ? { content, attributes }
        : undefined)) {
        document._frozenElements.add(el);
      }
    }
  }

  function unfreezeAttributes() {
    for (var el of document._frozenElements) {
      if (el._frozen.content) {
        el.textContent = el._frozen.content;
      }
      if (el._frozen.attributes) {
        for (const a of el._frozen.attributes) {
          el.setAttributeNS(a.namespaceURI, a.name, a.value);
        }
        if ("contentWindow" in el) {
          el.replaceWith(el.cloneNode(true));
        }
      }
      delete el._frozen;
    }
  }

  let domFreezer = new MutationObserver(records => {
    console.debug("domFreezer on", document.documentElement.outerHTML); // DEV_ONLY
    for (var r of records) {
      freezeAttributes([...r.addedNodes].filter(n => "outerHTML" in n));
    }
  });

  let suppressedScripts = 0;

  return {
    freeze() {
      if (document._frozenElements) {
        return false;
      }
      console.debug("Freezing", document.URL);
      document._frozenElements = new Set();
      for (let et of lazy.eventTypes) {
        document.addEventListener(et, suppressEvents, true);
      }
      try {
        freezeAttributes();
      } catch(e) {
        console.error(e);
      }
      domFreezer.observe(document, {childList: true, subtree: true});
      suppressedScripts = 0;
      firedDOMContentLoaded = false;
      return true;
    },
    unfreeze(live = true) {
      if (!document._frozenElements) {
        return false;
      }
      console.debug(`Unfreezing ${document.URL} ${live ? "live" : "off-document" }`);
      domFreezer.disconnect();
      const root = document.documentElement;
      try {
        if (!live) {
          root.remove();
        }
        unfreezeAttributes();
      } catch(e) {
        console.error(e);
      }
      for (const et of lazy.eventTypes) {
        document.removeEventListener(et, suppressEvents, true);
      }
      delete document._frozenElements;
      return root;
    },
    get suppressedScripts() { return suppressedScripts; },
    get firedDOMContentLoaded() { return firedDOMContentLoaded; },
  };
})();
