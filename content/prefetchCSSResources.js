"use strict";
function prefetchCSSResources(only3rdParty = false, ruleCallback = null) {
  async function sendMessage(type, args) {
    return await browser.runtime.sendMessage({
      __prefetchCSSResources__: {
        type, args
      }
    });
  }
  let corsEnabled = sendMessage("enableCORS");
  let ghostDoc;

  if (typeof ruleCallback !== "function") {
    ruleCallback = null;
  }

  let processed = new WeakSet();
  let { hostname } = location;
  let { baseURI } = document;
  let resources = new Set();
  let disabled = new WeakSet();
  // we can afford strict parsing because cssText gets normalized
  let resourceFinderRx = /url\("([^"]+)/g;

  let checkRule = rule => {
    if (!(rule instanceof CSSStyleRule)) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) {
          process(rule.styleSheet);
        } else {
          let loader = new Image();
          loader.onerror = () => process(rule.styleSheet);
          loader.src = rule.href;
        }
      }
      return;
    }
    let { cssText, parentStyleSheet } = rule;
    let base = parentStyleSheet.href || baseURI;
    let matches = cssText.match(resourceFinderRx);
    for (let m; (m = resourceFinderRx.exec(cssText));) {
      let resource = m[1];
      let url;
      try {
        url = new URL(resource, base);
      } catch (e) {
        continue;
      }
      if (only3rdParty && url.hostname === hostname) {
        continue;
      }

      let { href, origin } = url;
      if (resources.has(origin)) continue;
      resources.add(origin);
      if (ruleCallback && ruleCallback(rule, url)) {
        // if ruleCallback returns true we assume it handled or suppressed prefetching by itself
        continue;
      }
      // Unfortunately it seems we need to actually prefetch the resource due to dns-prefetch unreliablity.
      new Image().src = href;
    }
  };

  let process = sheet => {
    if (processed.has(sheet)) return;
    processed.add(sheet);
    let { ownerNode } = sheet;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      if (ownerNode && ownerNode._prefetching) {
        console.error("Error processing sheet", sheet, e);
        return;
      }
      sheet.disabled = true;

      // hack needed because disabled doesn't work on CSSImportRule.styleSheet
      let originalMedia = sheet.media.mediaText;
      if (sheet.ownerRule) sheet.media.mediaText = "speech and (width > 0)";

      let parent = ownerNode && ownerNode.parentElement || document.documentElement;
      let link = document.createElementNS("http://www.w3.org/1999/xhtml", "link");
      link.href = sheet.href;
      link.rel = "stylesheet";
      link.type = "text/css";
      link.crossOrigin = "anonymous";
      link._prefetching = true;
      link.onload = () => {
        link.sheet.disabled = true;
        process(link.sheet);
        link.remove();
        sheet.media.mediaText = originalMedia;
        sheet.disabled = false;
      }
      link.onerror = () => {
        console.error("Error fetching", link);
      }
      (async () => {
        await corsEnabled;
        parent.insertBefore(link, ownerNode || null);
      })();
      return;
    }
    for (let rule of sheet.cssRules) {
      checkRule(rule);
    }
    if (ownerNode instanceof HTMLStyleElement) {
      if (ownerNode.disabled && disabled.has(ownerNode)) {
        ownerNode.disabled = false;
        disabled.delete(ownerNode);
      }
      observer.observe(ownerNode, { characterData: true });
    }
  };

  let processAll = () => {
    for (let sheet of document.styleSheets) {
      process(sheet);
    }
  }

  let checkInlineImport = styleNode => {
    if (styleNode instanceof HTMLStyleElement && !styleNode.disabled) {
      let { textContent } = styleNode;
      if (/(?:^|[\s;}])@import\b/i.test(textContent)) {
        let { sheet } = styleNode;
        if (sheet) {
          process(sheet);
        } else {
          styleNode.disabled = true;
          disabled.add(styleNode);
          let importFinderRx = /(?:^|[\s;}])@import\s*(?:url\(\s*['"]?|['"])([^'"]+)/gi;
          for (let m; m = importFinderRx.exec(textContent);) {
            try {
              let url = new URL(m[1], baseURI);
              let loader = new Image();
              loader.onerror = e => {
                process(styleNode.sheet)
              };
              loader.src = url;
            } catch (e) { }
          }
        }
      }
    }
  }

  let observer = new MutationObserver(records => {
    for (let r of records) {
      if (r.addedNodes) {
        for (let n of r.addedNodes) {
          checkInlineImport(n);
        }
      } else if (r.type === "characterData") {
        checkInlineImport(r.target.parentElement);
      }
    }
    processAll();
  });

  observer.observe(document.documentElement, { subtree: true, childList: true });

  document.documentElement.addEventListener("load", ev => {
    if (ev.target instanceof HTMLLinkElement) {
      processAll();
    }
  }, true);

  document.addEventListener("readystatechange", () => {
    processAll();
    if (document.readyState === "complete") {
      sendMessage("disableCORS");
    }
  }, true);

  for (let styleNode of document.querySelectorAll("style")) {
    checkInlineImport(styleNode);
  }
  processAll();
}