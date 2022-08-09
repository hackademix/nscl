/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2022 Giorgio Maone <https://maone.net>
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

var TabTies = (() => {

  const map = new Map([[-1, new Set()]]);

  const ties =  {
    get(tabId) {
      return map.get(tabId) || map.set(tabId, new Set()).get(tabId);
    }
  };

  function tie(tab1Id, tab2Id) {
    if (!(tab2Id > -1 && tab1Id > -1)) return;
    ties.get(tab1Id).add(tab2Id);
    ties.get(tab2Id).add(tab1Id);
    debug("[TabTies] Tied", tab1Id, tab2Id, map);
  }

  function cut(tabId) {
    if (!(tabId > -1)) return;
    let deadTies = ties.get(tabId);
    for (let id of deadTies) {
      ties.get(id).delete(tabId);
    }
    map.delete(tabId);
    debug("[TabTies] Cut", tabId, map);
  }

  browser.webNavigation.onCreatedNavigationTarget.addListener(({sourceTabId, tabId})  => {
    tie(sourceTabId, tabId);
  });

  browser.webNavigation.onCommitted.addListener(details  => {
    debug("webNavigation.onCommited", details);
    let {tabId, frameId, transitionType, transitionQualifiers} = details;
    if (frameId !== 0) return;
    if (transitionType == "link" || transitionType === "form_submit") return;
    if (transitionQualifiers.some(tq => tq.endsWith("_redirect"))) return;
    cut(tabId);
    browser.tabs.executeScript({
      runAt: "document_start",
      code: "window.name = '';"
    });
  });


  browser.tabs.onCreated.addListener(({tabId, openerTabId}) => {
    tie(tabId, openerTabId);
  });

  browser.tabs.onRemoved.addListener(tabId => {
    cut(tabId);
  });

  (async () => {
    for (let tab of await browser.tabs.query({})) {
      tie(tab.id, tab.openerTabId);
    }
  })();

  return ties;
})();
