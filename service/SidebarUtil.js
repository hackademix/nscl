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

var SidebarUtil = {
  async guessSidebarWidth(tabId = -1) {
    if (!browser.windows) return 0;
    const window = await (tabId >= 0
      ? browser.windows.get((await browser.tabs.get(tabId)).windowId)
      : browser.windows.getLastFocused());
      return new Promise(async (resolve, reject) => {
        let tab;
        const onTab =  async (tabId, changeInfo, tabInfo) => {
          if (tabId != tab?.id || changeInfo.status != "complete") {
            return;
          }
          browser.tabs.onUpdated.removeListener(onTab);
          const outerWidth = window.width;
          try {
            await include("/nscl/service/Scripting.js");
            const innerWidth = (
              await Scripting.executeScript({
                target: { tabId: tab.id, frameId: 0 },
                func: () => window.innerWidth,
              })
            )[0].result;
            browser.tabs.remove(tab.id);
            resolve(outerWidth - innerWidth);
          } catch (e) {
            reject(e);
          }
        };
        browser.tabs.onUpdated.addListener(onTab);
        try {
          tab = await browser.tabs.create({
            windowId: window.id,
            active: false,
            url: browser.runtime.getURL("manifest.json"),
          });
        } catch (e) {
          browser.tabs.onUpdated.removeListener(onTab);
          reject(e);
        }
      });
    },
};
