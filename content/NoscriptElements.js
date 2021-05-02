"use strict";

var NoscriptElements = {
  refresh: false,
  emulate(emulateMetaRefresh = true) {
    this.emulate = () => {}; // call me just once

   let replace = (noscript) => {
      // force show NOSCRIPT elements content
      let replacement = createHTMLElement("span");
      replacement.innerHTML = noscript.innerHTML;
      // emulate meta-refresh
      if (emulateMetaRefresh) {
        for (let meta of replacement.querySelectorAll('meta[http-equiv="refresh"]')) {
          this.refresh = true;
          document.head.appendChild(meta);
          debug(`State %s, emulating`, document.readyState, meta);
        }
      }
      if (noscript.closest("head") && document.body) {
        document.body.insertBefore(noscript, document.body.firstChild);
      }
      noscript.replaceWith(replacement);
    }

    function replaceAll() {
      for (let noscript of document.querySelectorAll("noscript")) {
        replace(noscript);
      }
    }

    // replace any element already there
    replaceAll();

    if (document.readyState !== "complete") {
      // catch the other elements as they're added
      let observer = new MutationObserver(replaceAll);
      observer.observe(document.documentElement, {childList: true, subtree: true});
      addEventListener("DOMContentLoaded", function completed(e) {
        removeEventListener(e.type, completed);
        observer.disconnect();
        replaceAll();
      });
      return;
    }

    // document already loaded, we need to rewrite for refresh emulation
    if (this.refresh) {
      let html = document.documentElement.outerHTML;
      debug("Rewriting page to emulate meta-refresh", html);
      let doc = window.wrappedJSObject ? window.wrappedJSObject.document : window.document;
      try {
        doc.open();
        doc.write(html);
        doc.close();
      } catch (e) {
        error(e);
      }
    }
  }
};
