"use strict";
function prefetchCSSResources(only3rdParty = fals, ruleCallback = null) {
  if (typeof ruleCallback !== "function") {
    ruleCallback = null;
  }

  let processed = new WeakSet();
  let {hostname} = location;
  let {baseURI} = document;
  let resources = new Set();
  let disabled = new WeakSet();
  // we can afford strict parsing because cssText gets normalized
  let resourceFinderRx = /url\("([^"]+)/g;

  let checkRule = rule => {
    if (!(rule instanceof CSSStyleRule)) {
      if (rule.styleSheet) {
        process(rule.styleSheet);
      }
      return;
    }
    let {cssText, parentStyleSheet} = rule;
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

      let {href} = url;
      if (resources.has(href)) continue;
      resources.add(href);
      if (ruleCallback && ruleCallback(rule, url)) {
        // if ruleCallback returns true we assume it handled or suppressed prefetching by itself
        continue;
      }
      // Unfortunately it seems we need to actually prefetch the resource due to dns-prefetch unreliablity.
      // As a side effect we might be confusing some extra CSS+HTTP scriptless fingerprinting.
      new Image().src = href;
    }
  };

  let process = sheet => {
    if (processed.has(sheet)) return;
    for (let rule of sheet.cssRules) {
      checkRule(rule);
    }
    processed.add(sheet);
    let {ownerNode} = sheet;
    if (ownerNode instanceof HTMLStyleElement) {
      if (ownerNode.disabled && disabled.has(ownerNode)) {
        ownerNode.disabled = false;
        disabled.delete(ownerNode);
      }
      observer.observe(ownerNode, {characterData: true});
    }
  };

  let processAll = () => {
    for (let sheet of document.styleSheets) {
      process(sheet);
    }
  }

  let checkInlineImport = styleNode => {
    if (styleNode instanceof HTMLStyleElement && !styleNode.disabled) {
      let {textContent} = styleNode;
      if (/(?:^|[\s;}])@import\b/i.test(textContent)) {
        let {sheet} = styleNode;
        if (sheet && sheet.rules[0]) {
          process(sheet);
        } else {
          styleNode.disabled = true;
          disabled.add(styleNode);
          let importFinderRx = /(?:^|[\s;}])@import\s*(?:url\(\s*['"]?|['"])([^'"]+)/gi;
          for (let m; m = importFinderRx.exec(textContent);) {
            try {
              let url = new URL(m[1], baseURI);
              let loader = new Image();
              loader.onload = processAll;
              loader.src = url;
            } catch (e) {}
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

  observer.observe(document.documentElement, {subtree: true, childList: true});

  document.documentElement.addEventListener("load", ev => {
    if (ev.target instanceof HTMLLinkElement) {
      processAll();
    }
  }, true);

  document.addEventListener("readystatechange", processAll, true);

  for (let styleNode of document.querySelectorAll("style")) {
    checkInlineImport(styleNode);
  }
  processAll();
}