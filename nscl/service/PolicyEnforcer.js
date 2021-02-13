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