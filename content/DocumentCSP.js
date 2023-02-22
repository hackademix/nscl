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

'use strict';
class DocumentCSP {
  constructor(document) {
    this.document = document;
    this.builder = new CapsCSP();
  }

  apply(capabilities, embedding = CSP.isEmbedType(this.document.contentType)) {
    let {document} = this;
    if (!capabilities.has("script")) {
      // safety net for XML (especially SVG) documents and synchronous scripts running
      // while inserting the CSP <meta> element.
      document.defaultView.addEventListener("beforescriptexecute", e => {
        if (!e.isTrusted) return;
        e.preventDefault();
        debug("Fallback beforexecutescript listener blocked ", e.target);
      }, true);
    }

    let csp = this.builder;
    let blocker = csp.buildFromCapabilities(capabilities, embedding);
    if (!blocker) return null;

    let createHTMLElement =
      tagName => document.createElementNS("http://www.w3.org/1999/xhtml", tagName);

    let header = csp.asHeader(blocker);

    let meta = createHTMLElement("meta");
    meta.setAttribute("http-equiv", header.name);
    meta.setAttribute("content", header.value);

    let root = document.documentElement;
    try {
      if (!(document instanceof HTMLDocument)) {
        if (!(document instanceof XMLDocument)) {
          return null; // nothing to do with ImageDocument, for instance
        }
        // non-HTML XML documents ignore <meta> CSP unless wrapped in
        // - <html><head></head></head> on Gecko
        // - just <head></head> on Chromium
        console.debug("XML Document: temporary replacing %o with <HTML>", root);
        let htmlDoc = document.implementation.createHTMLDocument();
        let htmlRoot = document.importNode(htmlDoc.documentElement, true);
        document.replaceChild(htmlRoot, root);
      }

      let {head} = document;
      let parent = head ||
        document.documentElement.insertBefore(createHTMLElement("head"),
                            document.documentElement.firstElementChild);


      parent.insertBefore(meta, parent.firstElementChild);
      debug(`Failsafe <meta> CSP inserted in %s: "%s"`, document.URL, header.value);
      meta.remove();
      if (!head) parent.remove();
      if (document.documentElement !== root)
      {

        document.replaceChild(root, document.documentElement);
      }
    } catch (e) {
      error(e, "Error inserting CSP %s in %s", document.URL, header && header.value);
      return null;
    }
    return CSP.normalize(header.value);
  }
}
