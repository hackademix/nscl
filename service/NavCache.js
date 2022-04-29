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

var NavCache = (() => {

  let tabs = {};
  let listeners = new Set();

  let clone = structuredClone || (o => JSON.parse(JSON.stringify(o)));

  browser.webNavigation.onCommitted.addListener(({tabId, frameId, url, parentFrameId}) => {
    let tab = tabs[tabId];
    let frame = tab && tab[frameId];
    if (!tab || frameId == 0) {
      tabs[tabId] = tab = {};
    }
    let previousUrl = frame && frame.url;
    frame = tab[frameId] = {previousUrl, url, parentFrameId};
    if (previousUrl !== url) {
      for (let l of listeners) {
        try {
          l(Object.assign({tabId, frameId}, frame));
        } catch (e) {
          console.error(e);
        }
      }
    }
  });

  browser.tabs.onRemoved.addListener(tabId => {
    tabs.delete(tabId);
  });


  (async () => {

    async function populateFrames(tab) {
      let tabId = tab.id;
      let frames =  await browser.webNavigation.getAllFrames({tabId});
      if (!frames) return; // invalid tab
      if (!tabs[tabId]) tabs[tabId] = {};
      let top = tabs[tabId];
      for ({frameId, url, parentFrameId} of frames) {
        tab[frameId] = {url, parentFrameId};
      }
    }
    await Promise.all((await browser.tabs.query({})).map(populateFrames));
  })();

  return {
    getTab(tabId) {
      return clone(tabs[tabId] || {});
    },
    getFrame(tabId, frameId) {
      return clone((tabs[tabId] || {})[frameId]);
    },
    onUrlChanged: {
      addListener(listener) {
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.remove(listeners);
      }
    }
  };
})();
