/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2023 Giorgio Maone <https://maone.net>
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

class CSP {
  static isMediaBlocker(csp) {
    return /(?:^|[\s;])media-src (?:'none'|http:)(?:;|$)/.test(csp);
  }
  static normalize(csp) {
    return csp.replace(/\s*;\s*/g, ';').replace(/\b(script-src\s+'none'.*?;)(?:script-src-\w+\s+'none';)+/, '$1');
  }

  build(...directives) {
    return directives.join(';');
  }

  buildBlocker(...types) {
      return this.build(...(types.map(t => `${t.name || `${t.type || t}-src`} ${t.value || "'none'"}`)));
  }

  blocks(header, type) {
    return `;${header};`.includes(`;${type}-src 'none';`)
  }

  asHeader(value) {
    return {name: CSP.headerName, value};
  }
}

CSP.isEmbedType = type => /\b(?:application|video|audio)\b/.test(type) && !/^application\/(?:(?:xhtml\+)?xml|javascript)$/.test(type);
CSP.headerName = "content-security-policy";
CSP.patchDataURI = (uri, blocker) => {
  let parts = /^data:(?:[^,;]*ml|unknown-content-type)(;[^,]*)?,/i.exec(uri);
  if (!(blocker && parts)) {
    // not an interesting data: URI, return as it is
    return uri;
  }
  if (parts[1]) {
    // extra encoding info, let's bailout (better safe than sorry)
    return "data:";
  }
  // It's a HTML/XML page, let's prepend our CSP blocker to the document
  let patch = parts[0] + encodeURIComponent(
    `<meta http-equiv="${CSP.headerName}" content="${blocker}"/>`);
  return uri.startsWith(patch) ? uri : patch + uri.substring(parts[0].length);
}
