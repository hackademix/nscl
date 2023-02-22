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

class SyntaxChecker {
  constructor() {
    this.lastError = null;
    this.lastFunction = null;
    this.lastScript = "";
  }
  check(script) {
    this.lastScript = script;
    try {
      return !!(this.lastFunction = new Function(script));
    } catch(e) {
       this.lastError = e;
       this.lastFunction = null;
     }
     return false;
  }
  unquote(s, q) {
    // check that this is really a double or a single quoted string...
    if (s.length > 1 && s.startsWith(q) && s.endsWith(q) &&
      // if nothing is left if you remove all he escapes and all the stuff between quotes
      s.replace(/\\./g, '').replace(/^(['"])[^\n\r]*?\1/, '') === '') {
      try {
        return eval(s);
      } catch (e) {
      }
    }
    return null;
  }
}
