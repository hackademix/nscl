"use strict";

var NoscriptElements = {
  emulate(emulateMetaRefresh = true) {
    let refresh = false;
    for (let noscript of document.querySelectorAll("noscript")) {

      // force show NOSCRIPT elements content
      let replacement = createHTMLElement("span");
      replacement.innerHTML = noscript.innerHTML;
      // emulate meta-refresh
      if (emulateMetaRefresh) {
        for (let meta of replacement.querySelectorAll('meta[http-equiv="refresh"]')) {
          refresh = true;
          document.head.appendChild(meta);
          console.log(`State %s, emulating`, document.readyState, meta);
        }
      }
      if (noscript.closest("head") && document.body) {
        document.body.insertBefore(noscript, document.body.firstChild);
      }
      noscript.replaceWith(replacement);
    }
    if (refresh) {
      let html = document.documentElement.outerHTML;
      let rewrite = () => {
        let document = window.wrappedJSObject ? window.wrappedJSObject.document : window.document;
        try {
          document.open();
          document.write(html);
          document.close();
        } catch (e) {
          error(e);
        }
      };
      if (document.readyState === "complete") {
        rewrite();
      } else {
        window.addEventListener("load", e => {
          if (e.isTrusted) rewrite();
        });
      }
    }
  }
};
