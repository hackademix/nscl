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
var Storage = (() => {

  const chunksKey = k => `${k}/CHUNKS`;

  let lazyInitSync = async () => {
    lazyInitSync = null;

    const SYNC_KEYS = "__ALL_SYNC_KEYS__";
    let allSyncData;
    try {
      allSyncData = await browser.storage.sync.get();
    } catch (e) {
      // sync storage is disabled, bail out
      const syncKeys = (await browser.storage.local.get(SYNC_KEYS))[SYNC_KEYS];
      if (syncKeys) {
        const fallbackKeys = await getLocalFallback();
        await setLocalFallback(new Set([...fallbackKeys].concat(syncKeys)))
      }
      return;
    }

    const chunkedRx = /^([^/]+)\/(\d+|CHUNKS)$/;
    let keys = Object.keys(allSyncData);

    // sanitize / repair chunked keys
    const safeKeys = [];
    const repaired = {};

    for (let k of keys) {
      if (!k.endsWith("/0")) continue;
      const [keyName] = k.split("/");
      if (allSyncData[keyName] !== "[CHUNKED]") {
        // not flagged as chunked, bail out and doom the remnants
        continue;
      }
      const ccKey = chunksKey(keyName);
      const count = parseInt(allSyncData[ccKey]);
      const contiguousKeys = [];
      const keyPrefix = keyName.concat('/');
      for (let j = 1;; j++) {
        contiguousKeys.push(k);
        if (j >= count) break;
        k = keyPrefix.concat(j);
        if (!keys.includes(k)) break;
      }
      safeKeys.push(ccKey, ...contiguousKeys);
      const actualCount = contiguousKeys.length;
      if (count !== actualCount) {
        // try to repair
        repaired[ccKey] = actualCount;
      }
    }

    const doomedKeys = keys.filter(k => chunkedRx.test(k) && !safeKeys.includes(k));
    if (doomedKeys.length) {
      await browser.storage.sync.remove(doomedKeys);
    }
    if (Object.keys(repaired).length) {
      await browser.storage.sync.set(repaired);
    }

    {
      // backup sync data on local to survive on the fly sync disablement
      const localKeys = Object.keys(await browser.storage.local.get());
      const syncKeys = keys.filter(k => !chunkedRx.test(k));
      const backupKeys = syncKeys.filter(k => !localKeys.includes(k));
      const backupData = await Storage.get("sync", backupKeys);
      backupData[SYNC_KEYS] = syncKeys;
      await browser.storage.local.set(backupData);
    }


  };

  async function safeOp(op, type, keys) {
    let sync = type === "sync";
    try {
      if (sync) {

        if (lazyInitSync) await lazyInitSync();

        let remove = op === "remove";
        if (remove || op === "get") {
          keys = [].concat(keys); // don't touch the passed argument
          if (remove) {
            // remove local backup
            await browser.storage.local.remove(keys);
          }
          let mergeResults = {};
          let localFallback = await getLocalFallback();
          if (localFallback.size) {
            let localKeys = keys.filter(k => localFallback.has(k));
            if (localKeys.length) {
              if (remove) {
                for (let k of localKeys) {
                  localFallback.delete(k);
                }
                await setLocalFallback(localFallback);
              } else {
                mergeResults = await browser.storage.local.get(localKeys);
                keys = keys.filter(k => !localFallback.has(k));
              }
            }
          }

          if (keys.length) { // we may not have non-fallback keys anymore (for get)
            let chunkCounts = Object.entries(await browser.storage.sync.get(
                keys.map(chunksKey)))
                  .map(([k, count]) => [k.split("/")[0], count]);
            if (chunkCounts.length) {
              let chunkedKeys = [];
              for (let [k, count] of chunkCounts) {
                // prepare to fetch all the chunks at once
                while (count-- > 0) chunkedKeys.push(`${k}/${count}`);
              }
              if (remove) {
                const doomedKeys = keys
                  .concat(chunkCounts.map(([k, count]) => chunksKey(k)))
                  .concat(chunkedKeys);
                // remove all the keys included chunked, if any, from sync storage
                return await browser.storage.sync.remove(doomedKeys);
              } else {
                let chunks = await browser.storage.sync.get(chunkedKeys);
                for (let [k, count] of chunkCounts) {
                  let orderedChunks = [];
                  for (let j = 0; j < count; j++) {
                    orderedChunks.push(chunks[`${k}/${j}`]);
                  }
                  let whole = orderedChunks.join('');
                  try {
                    mergeResults[k] = JSON.parse(whole);
                    keys.splice(keys.indexOf(k), 1); // remove from "main" keys
                  } catch (e) {
                    error(e, "Could not parse chunked storage key %s (%s).", k, whole);
                  }
                }
              }
            }
          }
          return keys.length ?
            Object.assign(mergeResults, await browser.storage.sync[op](keys))
            : mergeResults;
        } else if (op === "set") {
          // create/update local backup
          await browser.storage.local.set(keys);

          keys = Object.assign({}, keys); // don't touch the passed argument
          const MAX_ITEM_SIZE = 4096;
          // Firefox Sync's max object BYTEs size is 16384, Chrome's 8192.
          // Rather than mesuring actual bytes, we play it safe by halving then
          // lowest to cope with escapes / multibyte characters.
          let removeKeys = [];
          for (let k of Object.keys(keys)) {
            let s = JSON.stringify(keys[k]);
            let chunksCountKey = chunksKey(k);
            let oldCount = (await browser.storage.sync.get(chunksCountKey))[chunksCountKey] || 0;
            let count;
            if (s.length > MAX_ITEM_SIZE) {
              count = Math.ceil(s.length / MAX_ITEM_SIZE);
              let chunks = {
                [chunksCountKey]: count
              };
              for(let j = 0, offset = 0; j < count; ++j) {
                chunks[`${k}/${j}`] = s.substring(offset, offset += MAX_ITEM_SIZE);
              }
              await browser.storage.sync.set(chunks);
              keys[k] = "[CHUNKED]";
            } else {
              count = 0;
              removeKeys.push(chunksCountKey);
            }
            while (oldCount-- > count) {
              removeKeys.push(`${k}/${oldCount}`);
            }
          }
          await browser.storage.sync.remove(removeKeys);
        }
      }

      let ret = await browser.storage[type][op](keys);
      if (sync && op === "set") {
        let localFallback = await getLocalFallback();
        let size = localFallback.size;
        if (size > 0) {
          for (let k of Object.keys(keys)) {
            localFallback.delete(k);
          }
          if (size > localFallback.size) {
            await setLocalFallback(localFallback);
          }
        }
      }
      return ret;
    } catch (e) {
      if (sync) {
        debug("Sync disabled? Falling back to local storage", op, keys, e);
        const localFallback = await getLocalFallback();
        const failedKeys = Array.isArray(keys) ? keys
          : typeof keys === "string" ? [keys] : Object.keys(keys);
        for (let k of failedKeys) {
          localFallback.add(k);
        }
        await setLocalFallback(localFallback);
      } else {
        error(e, "%s.%s(%o)", type, op, keys);
        throw e;
      }
    }

    return await browser.storage.local[op](keys);
  }

  const LFK_NAME = "__fallbackKeys";
  async function setLocalFallback(keys) {
    return await browser.storage.local.set({[LFK_NAME]: [...keys]});
  }
  async function getLocalFallback() {
    let keys = (await browser.storage.local.get(LFK_NAME))[LFK_NAME];
    return new Set(Array.isArray(keys) ? keys : []);
  }

  async function isChunked(key) {
    let ccKey = chunksKey(key);
    let data = await browser.storage.sync.get([key, ccKey]);
    return data[key] === "[CHUNKED]" && parseInt(data[ccKey]);
  }

  return {
    async get(type, keys) {
      return await safeOp("get", type, keys);
    },

    async set(type, keys) {
      return await safeOp("set", type, keys);
    },

    async remove(type, keys) {
      return await safeOp("remove", type, keys);
    },

    async hasLocalFallback(key) {
      return (await getLocalFallback()).has(key);
    },

    isChunked,
  };
})()
