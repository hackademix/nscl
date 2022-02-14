/*
 * NoScript Commons Library
 * Reusable building blocks for cross-browser security/privacy WebExtensions.
 * Copyright (C) 2020-2021 Giorgio Maone <https://maone.net>
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

var DNS = {
  supported: !!browser.dns,
  cache: {
    _: new Map(),
    _ext: new Set(),

    CAPACITY: 400, // when we purge, we cut this to half
    TTL: 60000,
    INVALID_TTL: 3000,

    get count() {
      return DNS.cache._.size;
    },

    has: function(host) {
      if (!DNS.cache._.has(host)) return false;
      let r = DNS.cache._.get(host);
      if (Date.now() > r.expiry) {
        DNS.cache.evict(host);
        return false;
      }
      return true;
    },
    get: function(host) {
      if (!DNS.cache.has(host)) return null;
      return DNS.cache._.get(host).dnsrec;
    },

    set: function(host, dnsrec) {
      let timestamp = Date.now();
      let expiry = timestamp + (dnsrec.addresses && dnsrec.addresses.length ? DNS.cache.TTL : DNS.cache.INVALID_TTL);
      DNS.cache._.set(host, {
        dnsrec,
        timestamp,
        expiry,
      });

      if (DNS.cache.count > DNS.cache.CAPACITY) {
        DNS.cache.purge();
      }
    },

    _oldLast: function(a, b) {
      return a.t > b.t ? -1 : a.t < b.t ? 1 : 0;
    },

    evict: function(host) {
      DNS.cache._.delete(host);
      DNS.cache._ext.delete(host);
    },

    purge: function() {
      let maxEntries = DNS.cache.CAPACITY / 2;
      if (DNS.cache.count < maxEntries) return;
      let l = Array.from(DNS.cache._.entries()).map((x) => {
        return {k: x[0], t: x[1].timestamp};
      });
      l.sort(DNS.cache._oldLast);
      for (let j = l.length; j-- > maxEntries;) {
        DNS.cache.evict(l[j].k);
      }
    },

    isExt: function(host) {
      return DNS.cache._ext.has(host);
    },
    setExt: function(host, state) {
      DNS.cache._ext[state ? 'add' : 'delete'](host);
    },

    clear: function() {
      DNS.cache._ = new Map();
      DNS.cache._ext = new Set();
    },
  },

  resolve: async function(host) {
    if (DNS.cache.has(host)) return DNS.cache.get(host);
    let dnsrec = await browser.dns.resolve(host);
    DNS.cache.set(host, dnsrec);
    return dnsrec;
  },

};
