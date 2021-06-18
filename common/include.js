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

var include = (() =>
{
  let  _inclusions = new Map();

  function scriptLoader(src) {
    let script = document.createElement("script");
    script.src = src;
    return script;
  }

  function styleLoader(src) {
    let style = document.createElement("link");
    style.rel = "stylesheet";
    style.type = "text/css";
    style.href = src;
    return style;
  }

  return async function include(src) {
    if (_inclusions.has(src)) return await _inclusions.get(src);
    if (Array.isArray(src)) {
      return await Promise.all(src.map(s => include(s)));
    }
    debug("Including", src);

    let loading = new Promise((resolve, reject) => {
      let inc = src.endsWith(".css") ? styleLoader(src) : scriptLoader(src);
      inc.onload = () => resolve(inc);
      inc.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(inc);
    });
    _inclusions.set(src, loading);
    return await (loading);
  }
})();
