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

var PlaceHolder = (() => {
  const HANDLERS = new Map();
  const CLASS_NAME = "__NoScript_PlaceHolder__ __NoScript_Theme__";
  const SELECTOR = `a.${CLASS_NAME.split(/\s+/).join('.')}`;
  const OFFSCREEN = new Set();

  const Theme = {
    _initializing: null,
    async _init() {
      let theme;
      try {
        theme = await Messages.send("getTheme");
        console.debug("getTheme returned", theme); // DEV_ONLY
        for (let replacement of [...document.querySelectorAll(SELECTOR)]) {
          this.update(replacement);
        }
      } catch (e) {
        console.error(e);
      }
      return Object.entries(theme || {});
    },
    async update(replacement) {
      replacement?.classList.toggle("no-theme", true);
      this._initializing ||= this._init();
      if (replacement) {
        for (const [className, toggle] of [...await this._initializing]) {
          replacement.classList.toggle(className, toggle);
        }
        replacement?.classList.toggle("no-theme", false);
      }
    }
  };

  if (document.querySelector(SELECTOR)) {
    // Bootstrap remote CSS on extension updates if the content script is injected in a page
    // already contains placeholders, e.g. on extension updates
    Theme.update();
  }

  class Handler {
    constructor(type, selector) {
      this.type = type;
      this.selector = selector;
      this.placeHolders = new Map();
      HANDLERS.set(type, this);
    }
    filter(element, request) {
      if (request.embeddingDocument) {
        return document.URL === request.url;
      }
      let url = request.initialUrl || request.url;
      return "data" in element ? element.data === url : element.src === url;
    }
    selectFor(request) {
      return [...document.querySelectorAll(this.selector)]
        .filter(element => this.filter(element, request))
    }
  }

  new Handler("frame", "iframe");
  new Handler("object", "object, embed");
  new Handler("media", "video, audio, source");

  function cloneStyle(src, dest,
    props = ["width", "height", "position", "*", "margin*"]) {
    var suffixes = ["Top", "Right", "Bottom", "Left"];
    for (let i = props.length; i-- > 0;) {
      let p = props[i];
      if (p.endsWith("*")) {
        let prefix = p.substring(0, p.length - 1);
        props.splice(i, 1, ...
          (suffixes.map(prefix ? (suffix => prefix + suffix) :
            suffix => suffix.toLowerCase())));
      }
    };

    const srcStyle = window.getComputedStyle(src, null);
    const destStyle = dest.style;
    for (const p of props) {
      destStyle[p] = srcStyle[p];
    }
    for (const size of ["width", "height"]) {
      if (/^0(?:\D|$)/.test(destStyle[size])) {
        destStyle[size] = "";
      }
    }

    // Work-around for video player displacement on Youtube
    {
      const h = src.offsetHeight;
      if (h > 0 &&
          (src.offsetTop <= -h || parseInt(srcStyle.bottom) <= -h
        )) {
        destStyle.top = destStyle.bottom = "";
      }
    }

    destStyle.display = srcStyle.display !== "block" ? "inline-block" : "block";
  }

  function clickListener(ev) {
    if (ev.button === 0 && ev.isTrusted) {
      let ph, replacement;
      for (let e of document.elementsFromPoint(ev.clientX, ev.clientY)) {
        if (ph = e._placeHolderObj) {
          replacement = e;
          break;
        }
        if (replacement = e._placeHolderReplacement) {
          ph = replacement._placeHolderObj;
          break;
        }
      }
      if (ph) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.target.value === "close") {
          ph.close(replacement);
        } else {
          ph.enable(replacement);
        }
      }
    }
  }

  class PlaceHolder {

    static create(policyType, request) {
      return new PlaceHolder(policyType, request);
    }
    static canReplace(policyType) {
      return HANDLERS.has(policyType);
    }
    static handlerFor(policyType) {
      return HANDLERS.get(policyType);
    }

    static listen() {
      window.addEventListener("click", clickListener, true);
    }

    constructor(policyType, request) {
      this.policyType = policyType;
      this.request = request;
      this.replacements = new Set();
      this.handler = PlaceHolder.handlerFor(policyType);
      if (this.handler) {
        [...document.querySelectorAll(this.handler.selector)]
        .filter(element => this.handler.filter(element, request))
          .forEach(element => this.replace(element));
      };
    }

    replace(element) {
      if (!element?.parentElement) {
        if (!this.request.offscreen || OFFSCREEN.has(this.policyType) || !document.body) {
          return;
        }
        // offscreen placeholder
        this.request.embeddingDocument = true;
        const CLASS = "__NoScript_Offscreen_PlaceHolders__";
        let offscreenContainer = document.querySelector(`.${CLASS}`);
        if (!offscreenContainer) {
          offscreenContainer = document.body.appendChild(createHTMLElement("div"));
          offscreenContainer.className = CLASS;
        }
        if (!element) element = createHTMLElement("span");
        OFFSCREEN.add(this.policyType);
        offscreenContainer.appendChild(element);
      }
      if (element.parentElement instanceof HTMLMediaElement) {
        this.replace(element.parentElement);
        return;
      }
      let {
        url
      } = this.request;
      let objUrl = new URL(url)
      this.origin = objUrl.origin;
      if (this.origin === "null") {
        this.origin = objUrl.protocol;
      }
      let TYPE = `<${this.policyType.toUpperCase()}>`;

      let replacement = createHTMLElement("a");
      replacement.className = CLASS_NAME;
      replacement.dataset.policyType = this.policyType; // help (users?) styling per-type

      cloneStyle(element, replacement);
      replacement.style.visibility = "hidden"; // ensure we don't flash on delayed CSS
      if (ns.embeddingDocument) {
        replacement.classList.add("__ns__document");
        window.stop();
      }

      replacement.href = url;
      replacement.title = `${TYPE}@${url}`;

      let inner = replacement.appendChild(createHTMLElement("span"));
      inner.className = replacement.className;

      let button = inner.appendChild(createHTMLElement("button"));
      button.className = replacement.className;
      button.setAttribute("aria-label", button.title = _("Close"));
      button.value = "close";
      button.textContent = "×";

      let description = inner.appendChild(createHTMLElement("span"));
      description.textContent = `${TYPE}@${this.origin}`;

      replacement._placeHolderObj = this;
      replacement._placeHolderElement = element;
      for (let e of replacement.querySelectorAll("*")) {
        e._placeHolderReplacement = replacement;
      }

      Theme.update(replacement);

      element.replaceWith(replacement);

      // do our best to bring it to front
      for (let p = replacement; p = p.parentElement;) {
        p.classList.add("__ns__pop2top");
      };

      this.replacements.add(replacement);
      PlaceHolder.listen();
    }

    async enable(replacement) {
      debug("Enabling %o", this.request, this.policyType);
      let ret = await Messages.send("blockedObjects", {
        url: this.request.url,
        policyType: this.policyType,
        documentUrl: document.URL
      });
      debug("Received response", ret);
      if (!ret) return;
      // bring back ancestors
      for (let p = replacement; p = p.parentElement;) {
        p.classList.remove("__ns__pop2top");
      };
      if (ret.collapse) {
        for (let collapsing of (ret.collapse === "all" ? document.querySelectorAll(SELECTOR) : [replacement])) {
          this.replacements.delete(collapsing);
          collapsing.remove();
        }
        return;
      }
      if (this.request.embeddingDocument) {
        window.location.reload();
        return;
      }
      try {
        let element = replacement._placeHolderElement;
        replacement.replaceWith(element.cloneNode(true));
        this.replacements.delete(replacement);
      } catch (e) {
        error(e, "While replacing");
      }
    }

    close(replacement) {
      replacement.classList.add("__ns__closing");
      this.replacements.delete(replacement);
      window.setTimeout(() => {
        for (let p = replacement; p = p.parentElement;) {
          p.classList.remove("__ns__pop2top");
        };
        replacement.remove()
      }, 500);
    }
  }

  return PlaceHolder;
})();
