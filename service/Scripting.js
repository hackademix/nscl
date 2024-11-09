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

globalThis.Scripting ||= (() => {

  function fixDefaults(details, css = false) {
    if (css) {
      if (!"origin" in details) {
        details.origin = "USER";
      }
    } else {
      if (!"injectImmediately" in details) {
        details.injectImmediately = true;
      }
    }
    const {target} = details;
    if ("frameId" in target) {
      target.frameIds = [target.frameId];
      delete target.frameId;
    } else if (!"allFrames" in target && !target.frameIds) {
      details.target.allFrames = true;
    }
    return details;
  }

  async function wrapResults(results, target) {
    const {frameId, frameIds, allFrames} = target;
    if (allFrames) {
      frameIds = (await browser.webNavigation.getAllFrames()).map(f => f.id);
    } else if (frameIds && frameId !== undefined) {
      frameIds = undefined;
    }
    return results.map((result, idx) => ({
        result,
        frameId: frameIds && frameIds[idx] || frameId || idx,
        documentId: "",
    }));
  }

  return browser.scripting
  ? {
    async executeScript(details) {
      return await browser.scripting.executeScript(fixDefaults(details));
    },
    async insertCSS(details) {
      return await browser.scripting.insertCSS(fixDefaults(details));
    },
  }
  : {
    async executeScript(details) {
      const {target} = details;
      const {frameId} = target;
      details = fixDefaults(details);
      const {tabId, allFrames, frameIds} = target;

      if (frameId === undefined && frameIds?.length) {
        const results = [];
        for (const frameId of frameIds) {
          target.frameId = frameId;
          results.push(... await this.executeScript(details));
        }
        return results;
      }

      const opts = {
        matchAboutBlank: true,
        runAt: details.injectImmediately ? "document_start" : "idle",
        allFrames,
        frameId,
      };

      if (details.files) {
        let results, exception;
        for(const file of files) {
          opts.file = file;
          try {
            results = await browser.tabs.executeScript(tabId, opts);
          } catch(e) {
            exception ||= e;
            console.error(e);
          }
        }
        if (results === undefined && exception) {
          throw exception;
        }
        return await wrapResults(results, target);
      }
      const args = Array.isArray(details.args) ? `...${JSON.stringify(args)}` : "";
      opts.code = `(${func})(${args})`;
      return await wrapResults(await browser.tabs.executeScript(tabId, opts), target);
    },

    async insertCSS(details) {
      const {target} = details;
      const {frameId} = target;
      fixDefaults(details, true);
      const {tabId, allFrames, frameIds} = target;
      if (frameId === undefined && frameIds?.length) {
        return Promise.allSettled(frameIds.map(async frameId => {
          let clone = structuredClone(details);
          clone.target.frameId = frameId;
          this.insertCSS(clone);
        }));
      }

      const opts = {
        matchAboutBlank: true,
        runAt: details.injectImmediately ? "document_start" : "idle",
        allFrames,
        frameId,
      };
      if (details.files) {
        return await Promise.allSettled(details.files.map(async file => {
          await browser.tabs.insertCSS(tabId, Object.assign({file}, opts));
        }));
      }
      browser.tabs.insertCSS(tabId, {
        code: css,
        frameId,
        runAt: "document_start",
        matchAboutBlank: true,
        cssOrigin: "user",
      });
    },
  };
})();
