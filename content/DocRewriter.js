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

"use strict";

var DocRewriter = (() => {
  const doc = document.wrappedJSObject || document;
  const pristine = {};
  for (const key of ["open", "write", "close"]) {
    const pristineMethod = doc[key];
    pristine[key] = (...args) => {
      pristineMethod.call(doc, ...args);
    }
  }

  function createSelector(el) {
    if (!(el instanceof Element)) return;
    const path = [];
    while (el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.parentNode && el !== document.documentElement) {
        // Get the index among siblings of the same type
        let index = 1;
        let sibling = el.previousElementSibling;

        while (sibling) {
          if (sibling.nodeName === el.nodeName) {
            index++;
          }
          sibling = sibling.previousElementSibling;
        }
        selector += `:nth-of-type(${index})`;
      }

      path.unshift(selector);
      el = el.parentNode;
      if (el === document || !el) break;
    }
    return path.join(" > ");
  }

  return {
    rewrite(content, conservative = false) {
      const { scrollX, scrollY } = window;
      const focusSelector = conservative &&
        (createSelector(document.activeElement) || "[autofocus]");
      const { doctype }  = document;
      pristine.open();
      if (doctype?.name) {
        // Even if tempting, DO NOT turn write() into writeln() here,
        // because it would just break the page leaving it blank.
        const parts = [doctype.name];
        const escape = s => s.replace(/"/g, "&quot;");
        if (doctype.publicId) {
          parts.push(`PUBLIC "${escape(doctype.publicId)}"`);
        }
        if (doctype.systemId) {
          if (!doctype.publicId) {
            parts.push("SYSTEM");
          }
          parts.push(`"${escape(doctype.systemId)}"`)
        }
        pristine.write(`<!DOCTYPE ${parts.join(" ")}>`);
      }
      pristine.write(content);
      pristine.close();
      if (conservative) {
        window.scrollTo(scrollX, scrollY);
        document.querySelector(focusSelector)?.focus();
      }
    }
  }
})();
