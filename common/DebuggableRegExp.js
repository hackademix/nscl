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

"use strict";

var DebuggableRegExp = (() => {

  return class DebuggableRegExp {

    constructor(rx, partsWrapper = null) {
      this.originalRx = rx;
      this.source = rx.source;
      this.flags = rx.flags;
      const chunks = rx.source.split("|");
      this._parts = [];
      let curPart = [];
      for (const c of chunks) {
        curPart.push(c);
        try {
          this._parts.push(new RegExp(curPart.join("|"), rx.flags));
          curPart = [];
        } catch (e) {
        }
      }
      if (partsWrapper) this._parts = this._parts.map(partsWrapper);
    }

    async test(s) {
      for (let part of this._parts) {
        try {
          if (await ("asyncTest" in part ? part.asyncTest(s) : part.test(s))) return true;
        } catch (e) {
          throw new Error(`${e.message}\ntesting RegExp:\n${part}\non string:\n${s}\n${e.stack}`);
        }
      }
      return false;
    }

    async asyncTest(s) {
      return await (this.asyncTest = this.test).call(this, s);
    }
  };

})();
