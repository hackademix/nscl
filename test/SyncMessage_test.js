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

"use strict";

if (browser.runtime.onSyncMessage) {
  // service side
  const DELAY = 500;

  const pingPongPang = new Promise(resolve => {
    browser.runtime.onSyncMessage.addListener(function onSyncMessage(msg, sender) {
      console.log("onSyncMessage", msg, sender);
      switch (msg.phase) {
        case "ping":
          return new Promise(resolve => {
            // introuduce a delay to test for asynchronous tasks
            const delayMatch = sender.url.match(/delay=(\d+)/);
            const delay = parseInt(delayMatch && delayMatch[1]) || 0;
            console.log(`onSyncMessage ${JSON.stringify(msg)}} returning in ${delay}ms from`, sender);
            setTimeout(() => resolve("pong"), delay);
          });
        case "pang":
          // be sure everything happened before the any script on the page could run
          resolve(msg.readyState === "loading" && msg.content === "<html></html>");
          browser.runtime.onSyncMessage.removeListener(onSyncMessage);
          return Promise.resolve("done");
      }
    });
  });

  const test = async () => {
    const url = `https://maone.net/test/docpolicy/?delay=${DELAY}`;
    const id = "SyncMessage_test";
    try {
      await browser.scripting.unregisterContentScripts({
        ids: [id]
      });
    } catch (e) {
      console.error(e);
    }
    await browser.scripting.registerContentScripts([{
      id,
      js: ["/test/SyncMessage_test.js"],
      runAt: "document_start",
      matches: [url],
    }]);
    const tab = await browser.tabs.create({url, active: false});
    const ret = await pingPongPang;
    browser.tabs.remove(tab.id);
    return ret;
  };

  (async () => {
    await Test.run(test);
    Test.report();
  })();

} else if (browser.runtime.sendSyncMessage) {
  // content side
  const sendMessage = (phase) => {
    let msg = {
      phase,
      readyState: document.readyState,
      content: document.documentElement.outerHTML,
      ts: Date.now()
    };
    console.log("Sending sync message", msg);
    let ret = browser.runtime.sendSyncMessage(msg);
    console.log("sendSyncMessage returned", ret);
    return ret;
  };
  if (sendMessage("ping") == "pong") {
    sendMessage("pang");
  }
}