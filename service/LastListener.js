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

/**
* Wrapper around listeners on various WebExtensions
* APIs (e.g. webRequest.on*), as a best effort to
* let them run last by removing and re-adding them
* on each call (swapping 2 copies because
* addListener() calls are asynchronous).
* Note: we rely on implementation details Like
* listeners being called in addition order; also,
* clients should ensure they're not called twice for
* the same event, if that's important.
}
*/

class LastListener {
  constructor(observed, listener, ...extras) {
    this.observed = observed;
    this.listener = listener;
    this.extras = extras;
    let ww = this._wrapped = [listener, listener].map(l => {
      let w = (...args) => {
        if (this.observed.hasListener(w._other)) {
          this.observed.removeListener(w);
        } else if (this.installed) {
          this.observed.addListener(w._other, ...this.extras);
        }
        debug("Running listener", w === ww[0] ? 0 : 1, ...args);
        return this.installed ? this.listener(...args)
          : this.defaultResult;
      }
      return w;
    });

    ww[0]._other = ww[1];
    ww[1]._other = ww[0];
    this.installed = false;
    this.defaultResult = null;
  }

  install() {
    if (this.installed) return;
    this.observed.addListener(this._wrapped[0], ...this.extras);
    this.installed = true;
  }

  uninstall() {
    this.installed = false;
    for (let l of this._wrapped) this.observed.removeListener(l);
  }
}
