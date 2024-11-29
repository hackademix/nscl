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

globalThis.include ||= (() =>
{
  if (self.importScripts) {
    const imported = new Set();
    const include = src => {
      if (Array.isArray(src)) {
        for (const s of src) {
          include(s);
        }
      } else if (!imported.has(src)) {
        console.debug("Importing ", src); // DEV_ONLY
        importScripts(src);
        imported.add(src);
      }
    };

    globalThis.include = include;
    // try to bootstrap dependencies from either from manifest.json or REQUIRED.js
    const {background} = (chrome || browser).runtime.getManifest();
    const requiredScripts = background?.scripts || (() => {
      try {
        // we expect the following script to contain
        // include.REQUIRED = [..., script];
        importScripts("/REQUIRED.js");
        return include.REQUIRED;
      } catch (e) {
        console.error(e);
      }
    })();
    if (requiredScripts) {
      // prevent self importing
      imported.add(requiredScripts.find(s => s.endsWith("common/include.js")));
      include(requiredScripts);
      // MV3 service worker needs lazy scripts to be pre-imported in the install event,
      // https://issues.chromium.org/issues/40760920#comment11
      addEventListener("install", ev => {
        include(requiredScripts);
        const rx = /(?:\bawait)?\s+include\s*\(\s*(["[][^)]+)/g;
        ev.waitUntil((async function recursive(scripts) {
          for (const src of scripts) {
            try {
              const code = await (await fetch(src)).text();
              for (let [, args] of code.matchAll(rx)) {
                let lazyScripts = JSON.parse(args);
                lazyScripts = (Array.isArray(lazyScripts) ? lazyScripts : [lazyScripts])
                  .filter(src => !imported.has(src));
                if (!lazyScripts.length) {
                  continue;
                }

                include(lazyScripts);
                await recursive(lazyScripts);
              }
            } catch (e) {
              console.error(e, "Trying to include recursively", src), scripts;
            }
          }
        })(requiredScripts));
      });
    }

    return include;
  }

  const _inclusions = new Map();

  const scriptLoader = src => {
    let script = document.createElement("script");
    script.src = src;
    return script;
  }

  const styleLoader = src => {
    let style = document.createElement("link");
    style.rel = "stylesheet";
    style.type = "text/css";
    style.href = src;
    return style;
  }

  return async src => {
    if (_inclusions.has(src)) return await _inclusions.get(src);
    if (Array.isArray(src)) {
      return await Promise.all(src.map(s => include(s)));
    }
    console.debug("Including", src); // DEV_ONLY

    let loading = new Promise((resolve, reject) => {
      let inc = src.endsWith(".css") ? styleLoader(src) : scriptLoader(src);
      inc.onload = () => resolve(inc);
      inc.onerror = () => reject(new Error(`Failed to load ${src}`));
      try {
        document.head.appendChild(inc);
      } catch (e) {
        console.error(e, "Fatal failed inclusion, reloading extension.");
        browser.runtime.reload();
      }
    });
    _inclusions.set(src, loading);
    return await (loading);
  }
})();
