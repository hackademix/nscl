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

if (typeof SharedWorkerGlobalScope !== "undefined" && self instanceof SharedWorkerGlobalScope) {
  // shared regExpWorker implementation
  const cache = new Map();

  onconnect = e => {
    const port = e.ports[0];
    debugger;
    port.onmessage = e => {
      let {id, asyncRegExp, testSubject, workerId} = e.data;
      debugger;
      const {source, flags} = asyncRegExp;
      const cacheKey = `/${source}/${flags}`;
      asyncRegExp = cache.get(cacheKey);
      if (!asyncRegExp) {
        cache.set(cacheKey, asyncRegExp = new RegExp(source, flags));
      }
      try {
        debugger;
        const result = asyncRegExp.test(testSubject);
        port.postMessage({asyncRegExpId: id, result, workerId});
      } catch (error) {
        port.postMessage({asyncRegExpId: id, error, workerId}, [error]);
      }
    }
  }
}


var AsyncRegExp = (() => {

  const inWorker = typeof DedicatedWorkerGlobalScope !== "undefined" && self instanceof DedicatedWorkerGlobalScope;

  const lazy = {
    get regExpWorker() {
      delete this.regExpWorker;
      let src = "/nscl/common/AsyncRegExp.js";
      const w = new SharedWorker(src);
      w.port.onmessage = resolveResult;
      w.port.onmessageerror = e => {
        error(e, "AsyncRegExp SharedWorker error.");
      }
      return this.regExpWorker = w;
    }
  }

  function dispatchToSharedWorker(data) {
    lazy.regExpWorker.port.postMessage(data);
  }

  const workers = new Map();
  const rxResolvers = new Map();
  let rxLastId = 0;
  let workerLastId = 0;

  async function regExpAsyncTest({source,flags}, testSubject) {
    return new Promise((resolve, reject) => {
      const id = ++rxLastId;
      rxResolvers.set(id, {resolve, reject});
      const data = {id, asyncRegExp: {source, flags}, testSubject};
      if (inWorker) {
        postMessage(data);
      } else {
        dispatchToSharedWorker(data);
      }
    });
  }


  function resolveResult({data}) {
    const {asyncRegExpId, result, error, workerId} = data;
    if (!asyncRegExpId) {
      return;
    }
    debug("AsyncRegExp resolve", data);
    if (!inWorker && workerId) {
      const worker = workers.get(workerId);
      if (!worker) return;
      workers.delete(workerId);
      while (!workers.has(workerLastId--) && workerLastId > -1);
      ++workerLastId;
      worker.postMessage(data);
      return;
    }

    const resolver = rxResolvers.get(asyncRegExpId);
    if (!resolver) {
      return;
    }
    const {resolve, reject} = resolver;
    if (resolve) {
      rxResolvers.delete(asyncRegExpId);
      while(!rxResolvers.has(rxLastId--) && rxLastId > -1);
      ++rxLastId;
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }
  }

  if (inWorker) {
    addEventListener("message", resolveResult);
  }

  return class AsyncRegExp extends RegExp {
    static connectWorker(worker) {
      worker.addEventListener("message", e => {
        const {data} = e;
        if (!(data && data.asyncRegExp)) {
          return;
        }
        debug("AsyncRegExp worker.onmessage", data);
        data.workerId = ++workerLastId;
        workers.set(data.workerId, worker);
        dispatchToSharedWorker(data);
      });
    }

    constructor(rx, ...args) {
      if (rx instanceof RegExp) {
        super(rx.source, rx.flags);
      } else {
        super(rx, ...args);
      }
    }

    async asyncTest(subject, forceRemote = this.forceRemote) {
      if (!forceRemote) {
        try {
          return this.test(subject);
        } catch (e) {
          console.error(e);
        }
      }
      return await regExpAsyncTest(this, subject);
    }
  };

})();