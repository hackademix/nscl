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

      const CanvasClass = window[canvas];
      const getContext = CanvasClass.prototype.getContext;

      const handler = cloneInto({
        apply: function(targetObj, thisArg, argumentsList) {
          if (thisArg instanceof CanvasClass && /webgl/i.test(argumentsList[0])) {
            let target = canvas === "HTMLCanvasElement" && document.contains(thisArg) ? thisArg : scope;
            env.port.postMessage("webgl", target);
            return null;
          }
          return getContext.call(thisArg, ...argumentsList);
        }
      }, scope, {cloneFunctions: true});

      const proxy = new scope.Proxy(getContext, handler);
      scope[canvas].prototype.getContext = proxy;
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
