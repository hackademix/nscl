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

// depends on /nscl/common/SessionCache.js

var TabTies = (() => {

  let map = new Map([[-1, new Set()]]);

  const session = new SessionCache(
    "TabTies",
    {
      afterLoad(data) {
        if (data) return map = new Map(data.map(([tabId, ties]) => [tabId, new Set(ties)]));
      },
      beforeSave() {
        return [...map.entries()]
          .filter(([, ties]) => ties?.[Symbol.iterator])
          .map(([tabId, ties]) => [tabId, [...ties]]);
      },
    }
  );

  function tie(tabId1, tabId2) {
    if (!(tabId1 > -1 && tabId2 > -1 && tabId1 !== tabId2)) return;

    // let's merge all the existing ties of each tab
    let allTies = new Set([...getTiesWithSelf(tabId1)]
      .concat([...getTiesWithSelf(tabId2)]));

    for (let tid of allTies) map.set(tid, allTies);
    debug("[TabTies] Tied", tabId1, tabId2, map); // DEV_ONLY
    session.save();
  }

  function cut(tabId) {
    if (!(tabId > -1)) return;
    let allTies = getTiesWithSelf(tabId);
    map.delete(tabId);
    allTies.delete(tabId);
    debug("[TabTies] Cut", tabId, map); // DEV_ONLY
    session.save();
  }

  function getTiesWithSelf(tabId) {
    let ties = map.get(tabId);
    return ties || map.set(tabId, ties = new Set([tabId])) && ties;
  }




  browser.webNavigation.onCreatedNavigationTarget.addListener(({sourceTabId, tabId})  => {
    tie(sourceTabId, tabId);
  });

  browser.webNavigation.onCommitted.addListener(async details => {
    debug("[TabTies] webNavigation.onCommitted", details); // DEV_ONLY
    let {tabId, frameId, transitionType, transitionQualifiers} = details;
    if (frameId !== 0) return;
    if (/^(?:link|form_submit|reload)$/.test(transitionType) ||
        transitionQualifiers.some(tq => tq.endsWith("_redirect"))) {
        // don't cut now, clients will check for user interaction in webRequest
      return;
    }
    cut(tabId);
    try {
      await Scripting.executeScript({
        target: {tabId, allFrames: false},
        func: () => { window.name = "" },
      });
    } catch (e) {
      // ignore, most likely a privileged page
    }
  });


  browser.tabs.onCreated.addListener(({id, openerTabId}) => {
    tie(id, openerTabId);
  });

  browser.tabs.onRemoved.addListener(tabId => {
    cut(tabId);
  });

  return {
    wakening: (async () => {
      await session.load(); // this fills map from session storage
      // we create a copy to discard any tab that's gone away since last wake up
      const updatedMap = new Map();
      for (const {id, openerTabId} of await browser.tabs.query({})) {
        if (!map.has(id)) {
          tie(id, openerTabId);
        }
        updatedMap.set(id, map.get(id));
      }
      map = updatedMap;
      session.save();
    })(),

    get(tabId) {
      let ties = new Set(getTiesWithSelf(tabId));
      ties.delete(tabId);
      return ties;
    },
    cut,
  }

})();
