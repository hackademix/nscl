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

var NavCache = (() => {

  let tabs = {};
  let listeners = new Set();

  let clone = structuredClone || (o => JSON.parse(JSON.stringify(o)));

  const navListener = ({ tabId, frameId, url, parentFrameId }) => {
      let tab = tabs[tabId];
      let frame = tab && tab[frameId];
      if (!tab) {
        tabs[tabId] = tab = {
          tabId,
          topUrls: new Set(),
        };
      }
      let previousUrl = frame?.url;
      frame = tab[frameId] = {
        tabId,
        frameId,
        parentFrameId,
        previousUrl,
        url,
      };
      if (parentFrameId == -1) tab.topUrls.add(url);
      if (previousUrl !== url) {
        for (const l of listeners) {
          try {
            l(clone(frame));
          } catch (e) {
            console.error(e);
          }
        }
      }
      populateFrames({ id: tabId }); // async refresh / garbage collect frames
    };

  browser.webNavigation.onBeforeNavigate.addListener(navListener);
  browser.webNavigation.onCommitted.addListener(navListener);

  browser.tabs.onRemoved.addListener(tabId => {
    delete tabs[tabId];
  });

  async function populateFrames(tab) {
    let tabId = tab.id;
    let frames =  await browser.webNavigation.getAllFrames({tabId});
    if (!frames) return; // invalid tab
    const t = tabs[tabId] ||= {
      tabId,
      topUrls: new Set(),
    };
    for ({frameId, url, parentFrameId} of frames) {
      t[frameId] = {tabId, frameId, url, parentFrameId};
      if (parentFrameId == -1) t.topUrls.add(url);
    }
  }

  return {
    wakening: (async () => {
      await Promise.all((await browser.tabs.query({})).map(populateFrames));
      return true;
    })(),

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
