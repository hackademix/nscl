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

'use strict';
{
  const _impl = "randomUUID" in crypto
    ? () => crypto.randomUUID()
    : () =>
      ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,
          c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4)
          .toString(16))
    ;

  // if crypto API is missing or broken
  const _fallback =  () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });

  var uuid = function() {
    try {
      return _impl();
    } catch (e) {
      return _fallback();
    }
  }
}
