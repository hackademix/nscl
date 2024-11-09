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

// include all the background script / service worker dependencies
browser.runtime.getManifest().background.scripts.filter(src => {
  // put here any exclusion
  return !/\bbrowser-polyfill\b/.test(src); // already in html
}).forEach(
  src => document.head.appendChild(document.createElement("script")).src = src
);

function out(msg) {
  const out = document.getElementById("out");
  out.appendChild(document.createElement("pre")).textContent = msg;
}

async function test() {
  out("Running tests...");
  console.clear();
  await include("/test/run.js");
  runTests();
  out("Open the console to see the results.");
}

addEventListener("click", ev => {
  switch (ev.target.id) {
    case "test":
      test();
    break;
  }
});