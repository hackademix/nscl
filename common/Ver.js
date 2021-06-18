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

"use strict";
class Ver {
  constructor(version) {
    if (version instanceof Ver) {
      this.versionString = version.versionString;
      this.parts = version.parts;
    } else {
      this.versionString = version.toString();
      this.parts = this.versionString.split(".");
    }
  }
  toString() {
    return this.versionString;
  }
  compare(other) {
    if (!(other instanceof Ver)) other = new Ver(other);
    let p1 = this.parts, p2 = other.parts;
    let maxParts = Math.max(p1.length, p2.length);
    for (let j = 0; j < maxParts; j++) {
      let s1 = p1[j] || "0";
      let s2 = p2[j] || "0";
      if (s1 === s2) continue;
      let n1 = parseInt(s1);
      let n2 = parseInt(s2);
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
      // if numeric part is the same, an alphabetic suffix decreases value
      // so a "pure number" wins
      if (!/\D/.test(s1)) return 1;
      if (!/\D/.test(s2)) return -1;
      // both have an alhpabetic suffix, let's compare lexicographycally
      if (s1 > s2) return 1;
      if (s1 < s2) return -1;
    }
    return 0;
  }
  static is(ver1, op, ver2) {
    let res = new Ver(ver1).compare(ver2);

    return op.includes("!=") && res !== 0 ||
      op.includes("=") && res === 0 ||
      op.includes("<") && res === -1 ||
      op.includes(">") && res === 1;
  }
}