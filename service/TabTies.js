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

var TabTies = (() => {

  const map = new Map([[-1, new Set()]]);


  function tie(tabId1, tabId2) {
    if (!(tabId1 > -1 && tabId2 > -1 && tabId1 !== tabId2)) return;

    // let's merge all the existing ties of each tab
    let allTies = new Set([...getTiesWithSelf(tabId1)]
      .concat([...getTiesWithSelf(tabId2)]));

    for (let tid of allTies) map.set(tid, allTies);

    debug("[TabTies] Tied", tabId1, tabId2, map);
  }

  function cut(tabId) {
    if (!(tabId > -1)) return;
    let allTies = getTiesWithSelf(tabId);
    map.delete(tabId);
    allTies.delete(tabId);
    debug("[TabTies] Cut", tabId, map);
  }

  function getTiesWithSelf(tabId) {
    let ties = map.get(tabId);
    return ties || map.set(tabId, ties = new Set([tabId])) && ties;
  }

  const ties =  {
    get(tabId) {
      let ties = new Set(getTiesWithSelf(tabId));
      ties.delete(tabId);
      return ties;
    },
    cut
  };


  browser.webNavigation.onCreatedNavigationTarget.addListener(({sourceTabId, tabId})  => {
    tie(sourceTabId, tabId);
  });

  browser.webNavigation.onCommitted.addListener(details  => {
    debug("[TabTies] webNavigation.onCommited", details);
    let {tabId, frameId, transitionType, transitionQualifiers} = details;
    if (frameId !== 0) return;
    if (/^(?:link|form_submit|reload)$/.test(transitionType) ||
        transitionQualifiers.some(tq => tq.endsWith("_redirect"))) {
        // don't cut now, clients will check for user interaction in webRequest
      return;
    }
    cut(tabId);
    browser.tabs.executeScript({
      runAt: "document_start",
      code: "window.name = '';"
    });
  });


  browser.tabs.onCreated.addListener(({id, openerTabId}) => {
    tie(id, openerTabId);
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
