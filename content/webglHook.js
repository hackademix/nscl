// depends on nscl/content/patchWindow.js
"use strict";
ns.on("capabilities", event => {
  debug("WebGL Hook", document.URL, document.documentElement && document.documentElement.innerHTML, ns.capabilities); // DEV_ONLY
  if (ns.allows("webgl")) return;
  let env = {eventName: `nsWebgl:${uuid()}`};
  window.addEventListener(env.eventName, e => {
    let request = {
      id: "noscript-webgl",
      type: "webgl",
      url: document.URL,
      documentUrl: document.URL,
      embeddingDocument: true,
    };
    seen.record({policyType: "webgl", request, allowed: false});
    let canvas = e.target;
    if (canvas instanceof HTMLCanvasElement) {
      try {
        let ph = PlaceHolder.create("webgl", request);
        ph.replace(canvas);
        PlaceHolder.listen();
      } catch (e) {
        error(e);
      }
    }
    notifyPage();
  }, true);

  function modifyGetContext(scope, env) {
    let dispatchEvent = EventTarget.prototype.dispatchEvent;
    for (let canvas of ["HTMLCanvasElement", "OffscreenCanvas"]) {
      if (!(canvas in scope)) continue;
      let proto = scope[canvas].prototype;
      let getContext = proto.getContext;
      exportFunction(function(type, ...rest) {
        if (/^webgl2?$/.test(type)) {
          let target = canvas === "HTMLCanvasElement" && document.contains(this) ? this : scope;
          dispatchEvent.call(target, new Event(env.eventName, {composed: true}));
          return null;
        }
        return getContext.call(this, type, ...rest);
      }, proto, {defineAs: "getContext"});
    }
  }

  patchWindow(modifyGetContext, env);
});
