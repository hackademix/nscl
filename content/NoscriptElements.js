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

"use strict";

var NoscriptElements = {
  refresh: false,
  emulate(emulateMetaRefresh = true) {
    this.emulate = () => {}; // call me just once

   let replace = (noscript) => {
      // force show NOSCRIPT elements content
      let replacement = createHTMLElement("span");
      replacement.innerHTML = noscript.innerHTML;
      // emulate meta-refresh
      if (emulateMetaRefresh) {
        for (let meta of replacement.querySelectorAll('meta[http-equiv="refresh"]')) {
          this.refresh = document.readyState;
          document.head.appendChild(meta);
          debug(`State %s, emulating`, document.readyState, meta);
        }
      }
      if (noscript.closest("head") && document.body) {
        document.body.insertBefore(noscript, document.body.firstChild);
      }
      // copy attributes
      for (let {name, value, namespaceURI} of noscript.attributes) {
        replacement.setAttributeNS(namespaceURI, name, value);
      }
      noscript.replaceWith(replacement);
    }

    function replaceAll() {
      for (let noscript of document.querySelectorAll("noscript")) {
        replace(noscript);
      }
    }

    // replace any element already there
    replaceAll();

    if (document.readyState === "loading") {
      // catch the other elements as they're added
      let observer = new MutationObserver(replaceAll);
      observer.observe(document.documentElement, {childList: true, subtree: true});
      let completed = e => {
        removeEventListener(e.type, completed);
        observer.disconnect();
        replaceAll();
        switch(this.refresh) {
          case "interactive":
            let v = navigator.userAgent.match(/Firefox\/(\d+)/);
            let noInteractiveRewrite = v && parseInt(v[1]) >= 88;
            if (noInteractiveRewrite) break;
          case "complete":
            rewrite();
        }
      };
      addEventListener("pageshow", completed);
      return;
    }


    // document already loaded, we need to rewrite for refresh emulation
    if (this.refresh) {
      rewrite();
    }

    function rewrite() {
      let html = document.documentElement.outerHTML;
      debug("Rewriting page to emulate meta-refresh", html);
      let doc = window.wrappedJSObject ? window.wrappedJSObject.document : window.document;
      try {
        doc.open();
        doc.write(html);
        doc.close();
      } catch (e) {
        error(e);
      }
    }
  }
};
