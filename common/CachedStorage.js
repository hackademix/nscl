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

  const addNameSpace = (nameSpace, properties, keys) => {
    const prefix = nameSpace ? `${nameSpace}.` : '';
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
    async init(properties = null, nameSpace = "", scope = null, storageType = "session") {
      if (!properties) {
        console.warn("CachedStorage.init(): no properties!")
        return null;
      }

      scope ??= nameSpace && globalThis[nameSpace] || globalThis;

      for (let p in properties) {
        if (p in scope) {
          // already initialized
          return scope;
        }
        break;
      }

      if (!(storageType in browser.storage)) {
        console.warn(`CachedStorage.init(): no browser.storage.${storageType}, falling back to vanilla properties`);
        return Object.assign(scope , properties);
      }


      const keys = Object.keys(properties);
      if (nameSpace) {
        properties = addNameSpace(nameSpace, properties, keys);
      } else {
        nameSpace = "";
      }

      let metadata = scopes.get(scope);
      if (!metadata) {
        scopes.set(scope, metadata = {});
      }

      const ns = (metadata[storageType] ??= new Map()).get(nameSpace);
      if (ns) {
        for (const key of keys) ns.add(key);
      } else {
        metadata[storageType].set(nameSpace, new Set(keys));
      }

      return Object.assign(scope,
        removeNameSpace(nameSpace,
          await browser.storage[storageType].get(properties)));
    },
    async save(scope = globalThis) {
      const metadata = await scopes.get(scope);
      if (!metadata) {
        console.warn(`CacheStorage.save(): metadata not found for scope ${scope}!`);
        return false;
      }
      const savingTasks = [];
      for (const [storageType, ns] of Object.entries(metadata)) {
        for (const [nameSpace, keys] of ns.entries()) {
          const properties = addNameSpace(nameSpace, scope, keys);
          savingTasks.push(browser.storage[storageType].set(properties));
        }
      }
      return await Promise.all(savingTasks);
    }
  }
})();
