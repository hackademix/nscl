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

// depends on /nscl/common/uuid.js

"use strict";
function prefetchCSSResources(only3rdParty = false, ruleCallback = null) {
  async function sendMessage(type, opts) {
    return await browser.runtime.sendMessage({
      __prefetchCSSResources__: {
        type, opts
      }
    });
  }

  const createElement = tagName => document.createElementNS("http://www.w3.org/1999/xhtml", tagName);

  const corsSheetURLs = new Set();
  const corsSheetsByHref = new Map();

  const shadows = new WeakMap();
  const getShadow = o => {
    let shadow = shadows.get(o);
    if (!shadow) shadows.set(o, shadow = {});
    return shadow;
  };

  const { port } = prefetchCSSResources;
  port.onMessage = (msg, {port, event}) => {
    const { node } = event;
    switch(msg) {
      case "isDisabled":
        let shadow = getShadow(node);
        return shadow.keepDisabled || (node.sheet && getShadow(node.sheet).keepDisabled);
      case "accessRules":
        return !(node.sheet && node.sheet.href && corsSheetURLs.has(node.sheet.href));
    }
  };

  port.onConnect = () => port.postMessage("patchWindow");
  if (port.connected) port.onConnect();

  if (typeof ruleCallback !== "function") {
    ruleCallback = null;
  }

  const processed = new WeakSet();
  const { hostname } = location;
  const { baseURI } = document;
  const resources = new Set();

  const styleClass = HTMLStyleElement, linkClass = HTMLLinkElement;

  const MEDIA_DISABLER = "speech and (width > 0px)"

  let keepDisabled = (o, v = true) => {
    let shadow = getShadow(o);
    if (!v === !shadow.keepDisabled) return false;
    let isSheet = o instanceof StyleSheet;
    if (!("keepDisabled" in shadow || isSheet)) {
      if (o instanceof styleClass) {
        observer.observe(o, { characterData: true, attributeFilter: ["media"] });
      } else {
        observer.observe(o, {attributeFilter: ["href", "media", "rel"]});
      }
    }
    shadow.keepDisabled = v;
    let toggleMedia = (o, prop, disabler = MEDIA_DISABLER) => {
      if (v === (o[prop] === disabler || prop === "mediaText" && o[prop] === "not all")) return;
      if (v) {
        if (!("originalMedia" in shadow)) {
          shadow.originalMedia = o[prop];
          o[prop] = disabler;
        }
      } else if ("originalMedia" in shadow) {
        o[prop] = shadow.originalMedia;
      }
    }
    toggleMedia(...(isSheet ?
        [o.media, "mediaText"]
      : [o, "media"]));
    return true;
  };

  // we can afford strict parsing because cssText gets normalized
  let resourceFinderRx = /url\("([^"]+)/g;

  let checkRule = rule => {
    if (!(rule instanceof CSSStyleRule)) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) {
          process(rule.styleSheet);
        } else {
          let loader = new Image();
          return new Promise(resolve => {
            loader.onerror = loader.onload = () => {
              resolve(process(rule.styleSheet));
            }
            loader.src = rule.href;
          });
        }
      }
      return false;
    }
    let { cssText, parentStyleSheet } = rule;
    let base = parentStyleSheet.href || baseURI;
    let matches = cssText.match(resourceFinderRx);
    for (let m; (m = resourceFinderRx.exec(cssText));) {
      let resource = m[1];
      let url;
      try {
        url = new URL(resource, base);
      } catch (e) {
        continue;
      }
      if (only3rdParty && url.hostname === hostname) {
        continue;
      }

      let { origin } = url;
      if (resources.has(origin)) continue;
      resources.add(origin);
      if (ruleCallback && ruleCallback(rule, url)) {
        // if ruleCallback returns true we assume it handled or suppressed prefetching by itself
        continue;
      }
      let { href } = url; // href might have been transformed by the callback
      // First let's try with DNS prefetching, which works nicely on Chromium.
      try {
        let l = createElement("link");
        l.href = href;
        l.rel = "dns-prefetch";
        document.documentElement.insertBefore(l, null);
        l.remove();
      } catch (e) {}
      // Unfortunately sometimes we need to actually prefetch the resource due to dns-prefetch unreliablity on Firefox.
      new Image().src = url.href;
    }
    return false;
  };

  let process = sheet => {
    if (!sheet || processed.has(sheet)) return;
    processed.add(sheet);
    let { ownerNode } = sheet;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      let {href} = sheet;
      if (!/^(?:(?:ht|f)tps?):/.test(href) || ownerNode && getShadow(ownerNode).prefetching === href) {
        if (/\bstill-loading\b/.test(e.message)) {
          // too early, let's retry on load
          processed.remove(sheet);
          return;
        }
        // just give up: either it's another extension (e.g. Stylus), or we've already tried, failing
        console.error("Error processing sheet", sheet, e);
        if (ownerNode) {
          keepDisabled(ownerNode, false);
        }
        return;
      }
      sheet.disabled = true;
      keepDisabled(sheet);
      let corsSheets = corsSheetsByHref.get(href);
      if (corsSheets) {
        corsSheets.add(sheet);
        return;
      } else {
        corsSheetsByHref.set(href, corsSheets = new Set([sheet]));
      }
      let link = createElement("link");
      let url = `${href}#${uuid()}`;
      corsSheetURLs.add(getShadow(link).prefetching = link.href = url);
      link.rel = "stylesheet";
      link.type = "text/css";
      link.crossOrigin = "anonymous";
      link.onerror = () => {
        console.error("Error fetching", link);
      }
      return new Promise(resolve => {
        link.onload = () => {
          link.onload = null;
          resolve(process(link.sheet));
          link.remove();
          for (let sheet of [...corsSheets]) {
            try {
              keepDisabled(sheet, false);
              sheet.disabled = false;
            } catch (e) {
              console.error(e);
            }
          }
          corsSheetsByHref.delete(href);
          if (ownerNode) {
            keepDisabled(ownerNode, false);
          }
        }
        (async () => {
          await sendMessage("enableCORS", {url});
          let parent = ownerNode && ownerNode.parentElement || document.documentElement;
          parent.insertBefore(link, ownerNode || null);
        })();
      });
    }
    keepDisabled(sheet);
    let pending = [];
    for (let rule of sheet.cssRules) {
      pending.push(checkRule(rule));
    }
    Promise.allSettled(pending).then(() => {
      keepDisabled(sheet, false);
      if (ownerNode) keepDisabled(ownerNode, false)
    });
  };

  let processAll = () => {
    for (let sheet of document.styleSheets) {
      process(sheet);
    }
  }

  let checkNode = styleNode => {
    if (getShadow(styleNode).keepDisabled) return;
    let { sheet } = styleNode;
    if (sheet) {
      process(sheet);
    } else if (styleNode instanceof styleClass) {
      let { textContent } = styleNode;
      if (/(?:^|[\s;}])@import\b/i.test(textContent)) {
        keepDisabled(styleNode);
        let importFinderRx = /(?:^|[\s;}])@import\s*(?:url\(\s*['"]?|['"])([^'"]+)/gi;
        for (let m; m = importFinderRx.exec(textContent);) {
          try {
            let url = new URL(m[1], baseURI);
            let loader = new Image();
            loader.onerror = e => {
              process(styleNode.sheet)
            };
            loader.src = url;
          } catch (e) { }
        }
      }
    } else if (styleNode instanceof linkClass
      && styleNode.relList.contains("stylesheet")
      && styleNode.href) {
      if (styleNode.media) {
        let mql = window.matchMedia(styleNode.media);
        if (!mql.matches) { // don't soft disable if current media query already does it ()
          getShadow(styleNode).mql = mql; // keep a reference alive until the node is not GCed
          mql.onchange = e => {
            checkNode(styleNode);
          }
          return;
        }
      }
      keepDisabled(styleNode);
    }
  }

  let observer = new MutationObserver(records => {
    for (var r of records) {
      switch(r.type) {
        case "childList": // any new link / style element?
          for (var n of r.addedNodes) {
            switch (n.constructor) {
              case styleClass:
              case linkClass:
                checkNode(n);
              break;
            }
          }
          break;
        case "characterData": // content of a style element changed?
          checkNode(r.target.parentElement);
        break;
        case "attributes":
          if (r.attributeName === "media") {
            let {target} = r;
            let shadow = getShadow(target);
            if (shadow.keepDisabled && target.media !== MEDIA_DISABLER) {
              shadow.originalMedia = target.media;
              target.media = MEDIA_DISABLER;
            }
          } else {
            checkNode(r.target);
          }
      }
    }
  });

  observer.observe(document.documentElement, { subtree: true, childList: true });

  let loadedLinks = new WeakMap();
  document.documentElement.addEventListener("load", ev => {
    let link = ev.target;
    if (link instanceof linkClass) {
      if (loadedLinks.get(link) !== link.href) {
        loadedLinks.set(link, link.href);
        processAll();
      } else {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    }
  }, true);

  document.addEventListener("readystatechange", () => {
    processAll();
  }, true);

  for (let styleNode of document.querySelectorAll("style")) {
    checkNode(styleNode);
  }
  processAll();
}

prefetchCSSResources.port = Worlds.connect("prefetchCSSResources", {});