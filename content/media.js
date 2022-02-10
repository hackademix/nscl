/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2021 Giorgio Maone <https://maone.net>
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

if ("MediaSource" in window) {
  let mediaBlocker;
  let notify = allowed => {
    let request = {
      id: "noscript-media",
      type: "media",
      url: document.URL,
      documentUrl: document.URL,
      embeddingDocument: true,
    };
    seen.record({policyType: "media", request, allowed});
    debug("MSE notification", document.URL); // DEV_ONLY
    notifyPage();
    return request;
  };
  let createPlaceholder = (mediaElement, request) => {
    try {
      let ph = PlaceHolder.create("media", request);
      ph.replace(mediaElement);
      PlaceHolder.listen();
      debug("MSE placeholder for %o", mediaElement); // DEV_ONLY
    } catch (e) {
      error(e);
    }
  };
  if ("SecurityPolicyViolationEvent" in window) {
    // "Modern" browsers
    let createPlaceholders = () => {
      let request = notify(false);
      for (let me of document.querySelectorAll("video,audio")) {
        if (!(me.src || me.currentSrc) || me.src.startsWith("blob")) {
          createPlaceholder(me, request);
        }
      }
    }
    let processedURIs = new Set();
    addEventListener("securitypolicyviolation", e => {
      let {blockedURI, violatedDirective, originalPolicy} = e;
      if (!(e.isTrusted && violatedDirective === "media-src" && CSP.isMediaBlocker(originalPolicy))) return;
      if (mediaBlocker === undefined && /^data\b/.test(blockedURI)) { // Firefox 81 reports just "data"
        debug("mediaBlocker set via CSP listener.")
        mediaBlocker = true;
        e.stopImmediatePropagation();
        mozPatch();
        return;
      }
      if (blockedURI.startsWith("blob") &&
          !processedURIs.has(blockedURI)) {
        processedURIs.add(blockedURI);
        setTimeout(createPlaceholders, 0);
      }
    }, true);
  }
  let mozPatch;
  if (typeof exportFunction === "function") {
    // Fallback: Mozilla does not seem to trigger CSP media-src http: for blob: URIs assigned in MSE
    window.wrappedJSObject.document.createElement("video").src = "data:"; // triggers early mediaBlocker initialization via CSP
    ns.on("capabilities", e => {
      mediaBlocker = !ns.allows("media");
      if (mediaBlocker) {
        debug("mediaBlocker set via fetched policy.");
        mozPatch();
      }
    });
    mozPatch = () => patchWindow((win, {xray})=> {
      mozPatch = () => {};
      let unpatched = new Map();
      function patch(obj, methodName, replacement) {
        let methods = unpatched.get(obj) || {};
        let method = xray.getSafeMethod(obj, methodName);
        methods[methodName] = method;
        obj[methodName] = exportFunction(replacement, obj, {original: obj[methodName]});
        unpatched.set(obj, methods);
      }
      let urlMap = new WeakMap();
      let URL = win.URL;
      patch(URL, "createObjectURL",  function(o, ...args) {
        let url = unpatched.get(URL).createObjectURL.call(this, o, ...args);
        if (o instanceof MediaSource) {
          let urls = urlMap.get(o);
          if (!urls) urlMap.set(o, urls = new Set());
          urls.add(url);
        }
        return url;
      });
      let MediaSourceProto = win.MediaSource.prototype;
      patch(MediaSourceProto, "addSourceBuffer", function(mime, ...args) {
        let ms = this;
        let urls = urlMap.get(ms);
        let request = notify(!mediaBlocker);
        if (mediaBlocker) {
          let exposedMime = `${mime} (MSE)`;
          setTimeout(() => {
            try {
              let allMedia = [...document.querySelectorAll("video,audio")];
              let me = allMedia.find(e => e.srcObject === ms ||
                urls && (urls.has(e.currentSrc) || urls.has(e.src))) ||
                // throwing may cause src not to be assigned at all:
                allMedia.find(e => !(e.src || e.currentSrc || e.srcObject));
              if (me) createPlaceholder(me, request);
            } catch (e) {
              error(e);
            }
          }, 0);
          let msg = `${exposedMime} blocked by NoScript`;
          log(msg);
          throw new Error(msg);
        }

        return unpatched.get(MediaSourceProto).addSourceBuffer.call(ms, mime, ...args);
      });
    });
  } else {
    mozPatch = () => {};
  }
}
