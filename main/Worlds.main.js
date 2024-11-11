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

Worlds?.exportFunction ||= (func, targetObject, {defineAs, original} = {}) => {
  try {
    let  [propDef, getOrSet, propName] = defineAs && /^([gs]et)(?:\s+(\w+))$/.exec(defineAs) || [null, null, defineAs];
    let propDes = propName && Object.getOwnPropertyDescriptor(targetObject, propName);
    if (getOrSet && !propDes) { // escalate through prototype chain
      for (let proto = Object.getPrototypeOf(targetObject); proto; proto = Object.getPrototypeOf(proto)) {
        propDes = Object.getOwnPropertyDescriptor(proto, propName);
        if (propDes) {
          targetObject = proto;
          break;
        }
      }
    }

    let toString = Function.prototype.toString;
    let strVal;
    if (!original) {
      original = propDef && propDes ? propDes[getOrSet] : defineAs && targetObject[defineAs];
    }
    if (!original) {
      // It seems to be a brand new function, rather than a replacement.
      // Let's ensure it appears as a native one with little hack: we proxy a Promise callback ;)
      Promise.resolve(new Promise(resolve => original = resolve));
      let name = propDef && propDes ? `${getOrSet} ${propName}` : defineAs;
      if (name) {
        let nameDef = Reflect.getOwnPropertyDescriptor(original, "name");
        nameDef.value = name;
        Reflect.defineProperty(original, "name", nameDef);
        strVal = toString.call(original).replace(/^function \(\)/, `function ${name}()`)
      }
    }

    strVal = strVal || toString.call(original);

    let proxy = new Proxy(original, {
      apply(target, thisArg, args) {
        return func.apply(thisArg, args);
      }
    });

    if (!exportFunction._toStringMap) {
      let map = new WeakMap();
      exportFunction._toStringMap = map;
      let toStringProxy = new Proxy(toString, {
        apply(target, thisArg, args) {
          return map.has(thisArg) ? map.get(thisArg) : Reflect.apply(target, thisArg, args);
        }
      });
      map.set(toStringProxy, toString.apply(toString));
      Function.prototype.toString = toStringProxy;
    }
    exportFunction._toStringMap.set(proxy, strVal);

    if (propName) {
      if (!propDes) {
        targetObject[propName] = proxy;
      } else {
        if (getOrSet) {
          propDes[getOrSet] = proxy;
        } else {
          if ("value" in propDes) {
            propDes.value = proxy;
          } else {
            return exportFunction(() => proxy, targetObject, `get ${propName}`);
          }
        }
        Object.defineProperty(targetObject, propName, propDes);
      }
    }
    return proxy;
  } catch (e) {
    console.error(e, `setting ${targetObject}.${defineAs || original}`, func);
  }
  return null;
};