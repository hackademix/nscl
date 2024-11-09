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

var CachedStorage = (() => {
  const scopes = new WeakMap();

  const DEFER_DELAY = 1000;
  let deferredTasks = null;
  const performTasks = async () => {
    for (let t of deferredTasks) t();
    deferredTasks = null;
  };
  const deferTasks = (...tasks) => {
    if (!deferredTasks) {
      deferredTasks = tasks;
      setTimeout(performTasks, DEFER_DELAY);
    } else {
      deferredTasks.push(...tasks);
    }
  };

  const addNameSpace = (nameSpace, properties, keys) => {
    const prefix = nameSpace ? `${nameSpace}.` : "";
    const nameSpacedProps = {};
    for (const key of keys) {
      nameSpacedProps[`${prefix}${key}`] = properties[key];
    }
    return nameSpacedProps;
  };
  const removeNameSpace = (nameSpace, properties) => {
    if (!nameSpace) return properties;
    const len = nameSpace.length + 1;
    const props = {};
    for (const [key, val] of Object.entries(properties)) {
      props[key.substring(len)] = val;
    }
    return props;
  };

  return {
    async init(
      properties = null,
      nameSpace = "",
      scope = null,
      storageType = "session"
    ) {
      if (!properties) {
        console.warn("CachedStorage.init(): no properties!");
        return null;
      }

      scope ??= (nameSpace && globalThis[nameSpace]) || globalThis;

      for (let p in properties) {
        if (p in scope) {
          // already initialized
          return scope;
        }
        break;
      }

      if (!(storageType in browser.storage)) {
        console.warn(
          `CachedStorage.init(): no browser.storage.${storageType}, falling back to vanilla properties`
        );
        return Object.assign(scope, properties);
      }

      const keys = Object.keys(properties);
      if (nameSpace) {
        properties = addNameSpace(nameSpace, properties, keys);
      } else {
        nameSpace = "";
      }

      let metadata = scopes.get(scope);
      if (!metadata) {
        scopes.set(scope, (metadata = { storage: {} }));
      }

      const ns = (metadata.storage[storageType] ??= new Map()).get(nameSpace);
      if (ns) {
        for (const key of keys) ns.add(key);
      } else {
        metadata.storage[storageType].set(nameSpace, new Set(keys));
      }
      return Object.assign(
        scope,
        removeNameSpace(
          nameSpace,
          await browser.storage[storageType].get(properties)
        )
      );
    },
    async save(scope = globalThis, defer = false) {
      const metadata = scopes.get(scope);
      if (!metadata) {
        console.warn(
          `CacheStorage.save(): metadata not found for scope ${scope}!`
        );
        return false;
      }

      if (metadata.deferredSave) return;
      if ((defer ||= Date.now() - metadata.lastSaved < 20)) {
        metadata.deferredSave = true;
        return Promise.resolve(
          deferTasks(() => {
            metadata.deferredSave = false;
            this.save(scope);
          })
        );
      }

      const savingTasks = [];
      for (const [storageType, ns] of Object.entries(metadata.storage)) {
        for (const [nameSpace, keys] of ns.entries()) {
          const properties = addNameSpace(nameSpace, scope, keys);
          savingTasks.push(browser.storage[storageType].set(properties));
        }
      }
      metadata.lastSaved = Date.now();
      return await Promise.allSettled(savingTasks);
    },
  };
})();
