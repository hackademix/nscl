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

"use strict";
{
  let requiredCORS = !UA.isMozilla;

  let enabled = new Map();
  let corsInfoCache = new Map();
  browser.tabs.onRemoved.addListener(tab => {
    enabled.delete(tab.id);
  });
  let reqKey = (frameId, destination, origin) => `${frameId}|${destination}@${origin}`;

  browser.runtime.onMessage.addListener(
    ({__prefetchCSSResources__: msg}, sender) => {
      if (!msg) return;
      let {tab, url, origin} = sender;
      if (!origin) origin = new URL(url).origin;
      let requests = enabled.get(tab.id);
      switch(msg.type) {
        case "enableCORS":
         if (!requests) {
            enabled.set(tab.id, requests = new Set());
          }
          requests.add(reqKey(sender.frameId, msg.opts.url, origin));
          return Promise.resolve(true);
      }
      return Promise.resolve(false);
  });

  let corsInfo = (r, forget = false) => {
    let {tabId, frameId, url, requestId} = r;
    if (corsInfoCache.has(requestId)) {
      let cached = corsInfoCache.get(requestId);
      if (forget) corsInfoCache.delete(requestId);
      return cached;
    }
    let origin = new URL(r.initiator || r.originUrl || r.documentUrl).origin;
    let destination = new URL(url).origin;
    let info;
    if (destination !== origin) {
      info = {origin};
      let requests = enabled.get(tabId);
      if (requests) {
        let key = reqKey(frameId, url, origin);
        info.authorize = requests.has(key);
        requests.delete(key);
      }
    } else {
      info = null;
    }
    corsInfoCache.set(requestId, info);
    return info;
  }


  let allCssFilter =  {
    urls: ['<all_urls>'],
    types: ['stylesheet']
  };

  let options = ['blocking'];
  browser.webRequest.onBeforeRequest.addListener(r => {
    corsInfo(r); // needed to cache corseInfo keying by requestId, instead of URL w/ #hash
  }, allCssFilter, options);

  options.push('requestHeaders');
  browser.webRequest.onBeforeSendHeaders.addListener(r => {
    let crossSite = corsInfo(r);
    if (!(crossSite && crossSite.authorize)) return;
    // here we try to force a cached response
    let {requestHeaders} = r;
    for (let h of requestHeaders) {
      let name = h.name.toLowerCase();
      if (name === "cache-control") {
        h.value = "max-age=604800"
      }
    }
    return {requestHeaders};
  }, allCssFilter, options);

  options[1] = 'responseHeaders';
  if (requiredCORS) {
    options.push('extraHeaders'); // required by Chromium to handle CORS headers
  }

  browser.webRequest.onHeadersReceived.addListener(r => {
    let crossSite = corsInfo(r);
    if (!crossSite) return;
    let {authorize, origin} = crossSite;
    let {responseHeaders} = r;

    if (authorize && !requiredCORS) return; // on Firefox we just need caching

    let headersPatch = Object.assign(Object.create(null), authorize
      ? {
        "cache-control": "no-store",
        "vary": "origin",
        "access-control-allow-origin": origin
      }
      : {
        "cache-control": "private, max-age=604800, immutable"
      });

    for (let h of responseHeaders) {
      let name = h.name.toLowerCase();
      if (name in headersPatch) {
        h.value = headersPatch[name];
        delete headersPatch[name];
      }
    }

    for (let [name, value] of Object.entries(headersPatch)) {
      responseHeaders.push({name, value});
    }

    return {responseHeaders};
  }, allCssFilter, options);

  let cleanup = r => {
    let crossSite = corsInfo(r, true);
    if (!(crossSite && crossSite.authorize)) return;
    if (!r.fromCache) {
      debug("Warning: cross-site CSS request from CSS resource prefetching NOT from cache.");
    }
  }
  for (let ev of ["onCompleted", "onErrorOccurred"]) {
    browser.webRequest[ev].addListener(cleanup, allCssFilter);
  }
}