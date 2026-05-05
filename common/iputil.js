/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2026 Giorgio Maone <https://maone.net>
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

globalThis.iputil = {
  localExtras: null,

  isLocalURI(uri, all = false, neverResolve = false) {
    var host;
    try {
      host = new URL(uri).hostname;
    } catch(e) {
      return false;
    }
    return this.isLocalHost(host, all, neverResolve);
  },

  _localDomainRx: /\.local$/i,
  isLocalHost(host, all = false, neverResolve = false) {
    if (!host) {
      return false;
    }
    if (host === "localhost" || this._localDomainRx.test(host)) return true;
    if (this.isIP(host)) {
      return this.isLocalIP(host);
    }

    if (!DNS.supported || all && DNS.cache.isExt(host) || neverResolve) return false;

    return DNS.resolve(host).then(res => {
      if (res.addresses) {
        let ret = false;
        for (let addr of res.addresses) {
          ret = this.isLocalIP(addr);
          if (all) {
            if (ret) {
              continue;
            }
            break;
          } else if (ret) {
            break;
          }
        }
        if (!ret) DNS.cache.setExt(host, true);
        return ret;
      } else {
        // I'm not sure if this can happen,
        // but MDN says DNSRecord objects "may" contain the properties (not "does" or "will") ...
        console.log(`No DNS addresses for '${host}' ?`, res);
        return false;
      }
    }, e => {
      if (e.message !== "NS_ERROR_UNKNOWN_PROXY_HOST") {
        console.error(e, host);
      }
      return false;
    });
  },

  _localIP6Rx: /^(?:::1?$|f(?:[cd]|e[c-f])[0-9a-f]*:)/i,
  get _localIPMatcher() {
    delete this._localIPMatcher;
    return this._localIPMatcher = new AddressMatcherWithDNS('0. 127. 10. 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 255.255.255.255');
  },
  isLocalIP(addr) {
    // see https://bug354493.bugzilla.mozilla.org/attachment.cgi?id=329492 for a more verbose but incomplete (missing IPv6 ULA) implementation
    // Relevant RFCs linked at http://en.wikipedia.org/wiki/Private_network
    // Note: we omit link-local IPv6 addresses (fe80:/10) on purpose, because they're currently found in the wild as misconfigured
    //       AAAA DNS records. The safest work-around is considering them external to the LAN always.

    // handle IPV6 with or without brackets
    if (addr.startsWith("[") && addr.endsWith("]")) {
      addr = addr.slice(1, -1);
    }
    return this._localIP6Rx.test(addr) ||
      this._localIPMatcher.testIP(addr = this.ip6to4(addr)) ||
      this.localExtras?.testIP(addr) ||
      typeof WAN === "object" && // only if a WAN resolver has been provided (e.g. by ABE)
      WAN.ipMatcher?.testIP(addr);
  },
  _ip6to4Rx: /^2002:([A-F0-9]{2})([A-F0-9]{2}):([A-F0-9]{2})([A-F0-9]{2})|:(?:\d+\.){3}\d+|^::ffff:([A-F0-9]+):([A-F0-9]+)$/i,
  ip6to4(addr) {
    const m = addr.match(this._ip6to4Rx);
    return m ?
      m[5] ?
        // RFC 4291 IPV4 mapped IPV6:
        // convert the lowest 32 bits from hex16:hex16 to dec8.dec8.dec8.dec8
        (dec32 => [
            (dec32 >>> 24) & 0xff,
            (dec32 >>> 16) & 0xff,
            (dec32 >>> 8) & 0xff,
            dec32 & 0xff
          ].join(".")
        )(parseInt(m[5], 16) << 16 | parseInt(m[6], 16))
      : (
        m[1]
        ? m.slice(1).map((h) => parseInt(h, 16)).join(".")
        : m[0].substring(1)
        )
      : addr;
  },
  _ipRx: /^(?:0\.|[1-9]\d{0,2}\.){3}(?:0|[1-9]\d{0,2})$|:.*:/i, // very restrictive, rejects IPv4 hex, octal and int32
  _ipRx_permissive: /^(?:(?:\d+|0x[a-f0-9]+)\.){0,3}(?:\d+|0x[a-f0-9]+)$|:.*:/i,
  isIP(host) { return this._ipRx.test(host); },
};
