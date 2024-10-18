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

if (typeof flextabs === "function") {

  for (let tabs of document.querySelectorAll(".flextabs")) {
    flextabs(tabs).init();
    let {id} = tabs;
    if (!id) continue;
    let storageKey = `persistentTab-${id}`;
    let rx = new RegExp(`(?:^|[#;])tab-${id}=(\\d+)(?:;|$)`);
    let current = location.hash.match(rx);
    if (!current) {
      current = localStorage && localStorage.getItem(storageKey);
    } else {
      current = current[1];
    }
    let toggles = Array.from(tabs.querySelectorAll(".flextabs__toggle"));
    let currentToggle = toggles[current && parseInt(current) || 0];
    if (currentToggle) currentToggle.click();
    for (let toggle of toggles) {
      toggle.addEventListener("click", e => {
        let currentIdx = toggles.indexOf(toggle);
        if (localStorage) localStorage.setItem(storageKey, currentIdx);
        location.hash = location.hash.split(";").filter(p => !rx.test(p))
          .concat(`tab-${id}=${currentIdx}`).join(";");
      });
    }
  }
}
