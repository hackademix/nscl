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

'use strict';
{
  let urlAttributes = ['href', 'to', 'from', 'by', 'values'];
  let selector = urlAttributes.map(a => `[${a}]`).join(',');

  for (let evType of ["drop", "paste"]) window.addEventListener(evType, e => {
    let container = e.target;
    let editing = false;
    for (let el = container; el; el = el.parentElement) {
      if (el.setRangeText || el.contentEditable) {
        editing = true;
        break;
      }
    }
    if (!editing) return;

    // we won't touch DOM elements which are already there
    let oldNodes = new Set(container.querySelectorAll(selector + ",form"));
    window.setTimeout(() => {
      // we delay our custom sanitization after the browser performed the paste
      // or drop job, rather than replacing it, in order to avoid interferences
      // with built-in sanitization
      try {
        let html = container.innerHTML;
        if (sanitizeExtras(container, oldNodes)) {
          let t = e.type.toUpperCase();
          console.log(`[NoScript] Sanitized\n<${t}>\n${html}\n</${t}>\nto\n<${t}>\n${container.innerHTML}\n</${t}>`, container);
        }
      } catch(ex) {
       console.log(ex);
      }
    }, 0);
  }, true);

  function removeAttribute(node, name, value = node.getAttribute(name)) {
    node.setAttribute(`data-noscript-removed-${name}`, value);
    node.removeAttribute(name);
  }

  function sanitizeExtras(container,  oldNodes = []) {
    let ret = false;

    // remove attributes from forms
    for (let f of container.getElementsByTagName("form")) {
      if (oldNodes.has(f)) continue;
      for (let a of [...f.attributes]) {
        removeAttribute(f, a.name);
      }
    }

    for (let node of container.querySelectorAll(selector)) {
      if (oldNodes.has(node)) continue;
      for (let name of urlAttributes) {
        let value = node.getAttribute(name);
        if (/^\W*(?:(?:javascript|data):|https?:[\s\S]+[[(<])/i.test(unescape(value))) {
          removeAttribute(node, name, value);
          ret = true;
        }
      }
    }
    return ret;
  }
}
