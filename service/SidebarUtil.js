/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2025 Giorgio Maone <https://maone.net>
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

// depends on nscl/service/SidebarUtil.tab.js

var SidebarUtil = {
  // Returns the difference between the outer and the inner width of the
  // window containing the tab identified by tabId, or of a new one in
  // the currently focused window
  async guessSidebarWidth(tabId = -1) {
    if (!browser.windows) return 0;
    if (tabId < 0) {
      const tab = (await browser.tabs.query({
        active: true,
        lastFocusedWindow: true,
        windowType: "normal"
      }))[0];
      if (!tab) return -1;
      tabId = tab.id;
    }
    const window = await browser.windows.get((await browser.tabs.get(tabId)).windowId);
    const outerWidth = window.width;
    await include("/nscl/service/Scripting.js");
    const getExtraWidth = async tabId => { // throws on privileged tabs
      const innerWidth = (
        await Scripting.executeScript({
          target: { tabId, frameId: 0 },
          func: () => window.innerWidth,
        })
      )[0].result;
      return outerWidth - innerWidth;
    };

    try {
      return await getExtraWidth(tabId);
    } catch (e) {
      // privileged tab
      debug(e);
    }

    for (const tab of (await browser.tabs.query({
        active: false,
        lastFocusedWindow: true,
        windowType: "normal"
      }))) {
      try {
        return await getExtraWidth(tab.id);
      } catch (e) {
        // privileged tab
        debug(e);
      }
    }

    // last resort: create a temporary unprivileged tab to measure
    return new Promise(async resolve => {
      let tab;
      const onTab = async (tabId, changeInfo, tabInfo) => {
        if (tabId != tab?.id || changeInfo.status != "complete") {
          return;
        }
        browser.tabs.onUpdated.removeListener(onTab);
        try {
          resolve(await getExtraWidth(tab.id));
        } catch(e) {
          debug(e);
          resolve(-1);
        }
        browser.tabs.remove(tab.id);
      };
      browser.tabs.onUpdated.addListener(onTab);
      try {
        tab = await browser.tabs.create({
          windowId: window.id,
          active: false,
          url: browser.runtime.getURL("nscl/service/SidebarUtil.tab.js"),
        });
      } catch (e) {
        resolve(-1);
        browser.tabs.onUpdated.removeListener(onTab);
      }
    });
  },
};
