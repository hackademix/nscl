// depends on nscl/content/patchWindow.js
"use strict";
ns.on("capabilities", event => {
  debug("WebGL Hook", document.URL, document.documentElement && document.documentElement.innerHTML, ns.capabilities); // DEV_ONLY
  if (ns.allows("webgl")) return;

  function modifyGetContext(scope, env) {
    let dispatchEvent = EventTarget.prototype.dispatchEvent;
    let { Event } = scope;
    for (let canvas of ["HTMLCanvasElement", "OffscreenCanvas"]) {
      if (!(canvas in scope)) continue;
      let proto = scope[canvas].prototype;
      let getContext = proto.getContext;
      exportFunction(function(type, ...rest) {
        let ctx = getContext.call(this, type, ...rest); // let the browser handle exceptions, if any
        if (ctx && /webgl/i.test(type)) {
          let target = canvas === "HTMLCanvasElement" && document.contains(this) ? this : scope;
          env.port.postMessage("webgl", target);
          return null;
        }
        return ctx;
      }, proto, {defineAs: "getContext"});
    }
  }

  let port = patchWindow(modifyGetContext);
  port.onMessage = (msg, {target: canvas}) => {
    if (msg !== "webgl") return;
    let request = {
      id: "noscript-webgl",
      type: "webgl",
      url: document.URL,
      documentUrl: document.URL,
      embeddingDocument: true,
    };
    seen.record({policyType: "webgl", request, allowed: false});
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
  }
});
