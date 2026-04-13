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

var ContextStore = (() => {
  'use strict';

  class ContextStore {

    constructor(contextStoreData) {
      this.enabled = Boolean(contextStoreData && contextStoreData.enabled);
      this.policies = ({});
      if (contextStoreData && contextStoreData.policies) {
        for (const [cookieStoreId, policy] of Object.entries(contextStoreData.policies)) {
          this.policies[cookieStoreId] = new Policy(policy);
        }
      }
    }

    static hydrate(dry, contextObj) {
      let newPolicies = new Object();
      for (const [cookieStoreId, policy] of Object.entries(dry.policies)) {
        newPolicies[cookieStoreId] = new Policy(contextObj.policies[cookieStoreId]);
      }
      var newContextStore = ({
        enabled: dry.enabled,
        policies: newPolicies,
      });
      newContextStore = contextObj ? Object.assign(contextObj, newContextStore)
        : new ContextStore(newContextStore);
      return newContextStore;
    }

    dry(includeTemp = false) {
      var policies = Object.assign({}, this.policies);
      for (const [cookieStoreId, policy] of Object.entries(policies)) {
        policies[cookieStoreId] = policy.dry(includeTemp);
      }
      return ({
        enabled: this.enabled,
        policies,
      });
    }

    revokeTemp() {
      ContextStore.hydrate(this.dry(), this);
      return this;
    }

    setAll(params = {}) {
      for (const [key, value] of Object.entries(params)) {
        for (const [cookieStoreId, policy] of Object.entries(this.policies)) {
          policy[key] = value;
        }
      }
    }

    get snapshot() {
      return JSON.stringify(this.dry(true));
    }

    equals(other) {
      this.snapshot === other.snapshot;
    }

    updatePresets(policy) {
      Object.entries(this.policies).forEach(([cookieStoreId, containerPolicy]) => {
        containerPolicy.DEFAULT.capabilities = new Set(policy.DEFAULT.capabilities);
        containerPolicy.TRUSTED.capabilities = new Set(policy.TRUSTED.capabilities);
        containerPolicy.UNTRUSTED.capabilities = new Set(policy.UNTRUSTED.capabilities);
      });
    }

    async updateContainers(defaultPolicy = null) {
      if (!(this.enabled && browser.contextualIdentities)) {
        return;
      }
      let identities;
      try {
        identities = await browser.contextualIdentities.query({});
      } catch (e) {
        // privacy.userContext.ui.enabled pref turned to false mid session?
        this.enabled = false;
        this.disabledByHost = true;
      }
      if (!identities) {
        return;
      }
      identities.forEach(({cookieStoreId}) => {
        if (!this.policies.hasOwnProperty(cookieStoreId)) {
          if (!defaultPolicy) {
            defaultPolicy = new Policy().dry();
          } else if (typeof defaultPolicy.dry == 'function') {
            defaultPolicy = defaultPolicy.dry();
          }
          this.policies[cookieStoreId] = new Policy(defaultPolicy);
        }
      })
    }
  }

  return ContextStore;
})();
