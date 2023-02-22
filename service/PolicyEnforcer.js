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
/**
 * This class will use the best strategy available on the current browser platform
 * (sniffed at object construction time) in order to enforce a given policy
 * (see nscl/common/Policy.js)
 */
class PolicyEnforcer {

  /**
   * Creates a PolicyEnforcer object, sniffing the available APIS and configuring
   * the best enforcing strategy.
   * At the moment, the most likely paths are 2:
   *
   * 1) blocking webRequest + contentScripts.register() on Firefox
   * 2) declarativeNetRequest + scripting.registerContentScript() (and/or declarativeContent?) on Chromium
   *
   * Chromium's new APIs are still a moving target for important use cases, see
   * - https://bugs.chromium.org/p/chromium/issues/detail?id=1043200
   * - https://bugs.chromium.org/p/chromium/issues/detail?id=1128112
   * - https://bugs.chromium.org/p/chromium/issues/detail?id=1054624
   */
  costructor() {
    this._enforceActually = "declarativeNetRequest" in browser ? this._dntEnforce : this._bwrEnforce;
  }

  /**
   * Enforces the given policy, or stops enforcing any policy if passed null
   *
   * @param {object} policy the nscl/common/Policy instance to be enforced (or JSON serialization, or null)
   */
  async enforce(policy) {
    return await this._enforceActually(policy);
  }

  async _dntEnforce(policy) {
    if ("dry" in policy) policy = policy.dry();
    // TODO: iterate over each preset and custom rules, creating RE2 regexFilters and CSP to enforce the policy
  }

  async _bwrEnforce(policy) {

  }


}