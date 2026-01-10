/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2026 Giorgio Maone <https://maone.net>
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
globalThis.DocumentFreezer = (() => {

  const loaderAttributes = ["data", "href", "src", "xlink"];
  const scriptAttributes = ["language", "type"];
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
      const attributes = [];
      const loaders = [];
      const isScript = el.localName.toLowerCase() == "script";
      for (const a of el.attributes) {
        const name = a.localName.toLowerCase();
        if (loaderAttributes.includes(name)) {
          if (jsOrDataUrlRx.test(a.value)) {
            loaders.push(a);
          }
        } else if (name.startsWith("on")) {
          console.debug("Removing", a, el.outerHTML); // DEV_ONLY
          attributes.push(a.cloneNode());
          a.value = "";
          el[name] = null;
        } else if (isScript && scriptAttributes.includes(name)) {
          attributes.push(a.cloneNode());
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
      if ((el._frozen = (isScript || attributes.length)
        ? { attributes, isScript }
        : undefined)) {
        if (isScript) {
          suppressedScripts++;
          const { nameSpaceURI } = el;
          for (const name of scriptAttributes) {
            el.setAttributeNS(nameSpaceURI, name, "disabled");
          }
        }
        document._frozenElements.add(el);
      }
    }
  }

  function unfreezeAttributes() {
    for (var el of document._frozenElements) {
      if (el._frozen.isScript) {
        const { nameSpaceURI } = el;
        for (const name of scriptAttributes) {
          el.removeAttributeNS(nameSpaceURI, name);
        }
      }
      if (el._frozen.attributes) {
        for (const a of el._frozen.attributes) {
          el.setAttributeNodeNS(a);
        }
        if ("contentWindow" in el) {
          el.replaceWith(el.cloneNode(true));
        }
      }
      delete el._frozen;
    }
  }

  let firstCall = true;
  const domFreezer = new MutationObserver(records => {
    if (firstCall) {
      freezeAttributes();
      firstCall = false;
    }
    console.debug("domFreezer on", document.documentElement.outerHTML, records); // DEV_ONLY
    for (var r of records) {
      freezeAttributes([...r.addedNodes].filter(n => "outerHTML" in n));
    }
    console.debug("domFreezer froze", document.documentElement.outerHTML, records); // DEV_ONLY
  });

  let suppressedScripts = 0;

  return {
    freeze() {
      if (document._frozenElements) {
        return false;
      }
      console.debug("Freezing", document.URL, document.documentElement.outerHTML);
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
      domFreezer.disconnect();
      const root = document.documentElement;
      try {
        if (!live) {
          root.remove();
        }
        console.debug(`Unfreezing ${document.URL} ${live ? "live" : "off-document" }`, root.outerHTML);
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
