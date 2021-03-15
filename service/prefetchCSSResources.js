"use strict";
{
  let enabled = new Map();

  browser.tabs.onRemoved.addListener(tab => {
    enabled.delete(tab.id);
  });

  browser.runtime.onMessage.addListener(
    ({__prefetchCSSResources__: msg }, sender) => {
      if (!msg) return;
      let {tab, url, origin} = sender;
      if (!origin) origin = new URL(url).origin;
      let origins = enabled.get(tab.id);
      switch(msg.type) {
        case "enableCORS":
         if (!origins) {
            enabled.set(tab.id, origins = new Set());
          }
          origins.add(origin);
        return Promise.resolve(true);
        case "disableCORS":
          if (origins) {
            origins.delete(origin);
            return Promise.resolve(true);
          }
        break;
      }
      return Promise.resolve(false);
  });

  browser.webRequest.onHeadersReceived.addListener(r => {
    let {tabId} = r;
    if (!enabled.has(tabId)) return;
    let origin = new URL(r.initiator || r.originUrl).origin;
    if (!enabled.get(tabId).has(origin)) return;

    let {responseHeaders} = r;
    let found = false;
    for (let h of responseHeaders) {
      if (h.name.toLowerCase() === "access-control-allow-origin") {
        h.value = "*";
        found = true;
      }
    }

    if (!found) {
      responseHeaders.push({
        'name': 'Access-Control-Allow-Origin',
        'value': '*'
      });
    }
    return {responseHeaders};
  }, {
    urls: ['<all_urls>'],
    types: ['stylesheet']
  }, ['blocking', 'responseHeaders', 'extraHeaders']);
}