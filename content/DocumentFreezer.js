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
    unfreezeLive() {
      return this.unfreeze(true);
    },
    unfreezeDetached() {
      return this.unfreeze(false);
    },
    unfreezeAutoReload() {
      if (!this.isFrozen) {
        return;
      }

      if (this.suppressedScripts == 0 && document.readyState == "loading") {
        // we don't care reloading, if no script has been suppressed
        // and no readyState change has been fired yet
        this.unfreezeLive(); // live
        return;
      }

      const softReload = ev => {
        removeEventListener("DOMContentLoaded", softReload, true);
        try {
          debug("Soft reload", ev); // DEV_ONLY
          try {
            const isDir = document.querySelector("link[rel=stylesheet][href^='chrome:']")
                && document.querySelector(`base[href^="${url}"]`);
            if (isDir || document.contentType !== "text/html") {
              throw new Error(`Can't document.write() on ${isDir ? "directory listings" : document.contentType}`)
            }

            const root = this.unfreeze(false); // off-document
            const html = root.outerHTML;
            DocRewriter.rewrite(html, true);
            debug("Written", html); // DEV_ONLY
            // Work-around this rendering bug: https://forums.informaction.com/viewtopic.php?p=103105#p103050
          } catch (e) {
            debug("Can't use document.write(), XML document?", e);
            try {
              const eventSuppressor = ev => {
                if (ev.isTrusted) {
                  debug("Suppressing natural event", ev);
                  ev.preventDefault();
                  ev.stopImmediatePropagation();
                  ev.currentTarget.removeEventListener(ev.type, eventSuppressor, true);
                }
              };
              const svg = document.documentElement instanceof SVGElement;
              if (svg) {
                document.addEventListener("SVGLoad", eventSuppressor, true);
              }
              document.addEventListener("DOMContentLoaded", eventSuppressor, true);
              if (ev) {
                eventSuppressor(ev);
              }
              DocumentFreezer.unfreezeLive();
              const scripts = [], deferred = [];
              // push deferred scripts, if any, to the end
              for (const s of document.getElementsByTagName("script")) {
                (s.defer && !s.text ? deferred : scripts).push(s);
                s.addEventListener("beforescriptexecute", e => {
                  console.debug("Suppressing", script);
                  e.preventDefault();
                });
              }
              if (deferred.length) {
                scripts.push(...deferred);
              }
              const doneEvents = ["afterscriptexecute", "load", "error"];
              (async () => {
                for (const s of scripts) {
                  const clone = document.createElementNS(s.namespaceURI, "script");
                  for (const a of s.attributes) {
                    clone.setAttributeNS(a.namespaceURI, a.name, a.value);
                  }
                  clone.innerHTML = s.innerHTML;
                  await new Promise(resolve => {
                    const listener = ev => {
                      if (ev.target !== clone) return;
                      debug("Resolving on ", ev.type, ev.target);
                      resolve(ev.target);
                      for (const et of doneEvents) {
                        removeEventListener(et, listener, true);
                      }
                    };
                    for (const et of doneEvents) {
                      addEventListener(et, listener, true);
                    }
                    s.replaceWith(clone);
                    debug("Replaced", clone);
                  });
                }
                debug("All scripts done, firing completion events.");
                document.dispatchEvent(new Event("readystatechange"));
                if (svg) {
                  document.documentElement.dispatchEvent(new Event("SVGLoad"));
                }
                document.dispatchEvent(new Event("DOMContentLoaded", {
                  bubbles: true,
                  cancelable: false
                }));
                if (document.readyState === "complete") {
                  window.dispatchEvent(new Event("load"));
                }
              })();
            } catch (e) {
              error(e);
            }
          }
        } catch(e) {
          error(e);
        }
      };

      if (DocumentFreezer.firedDOMContentLoaded || document.readyState !== "loading") {
        softReload();
      } else {
        debug("Deferring softReload to DOMContentLoaded..."); // DEV_ONLY
        addEventListener("DOMContentLoaded", softReload, true);
      }
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
    get isFrozen() {
      return !!document._frozenElements;
    },
    get suppressedScripts() { return suppressedScripts; },
    get firedDOMContentLoaded() { return firedDOMContentLoaded; },
  };
})();
