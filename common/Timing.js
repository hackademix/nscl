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

class Timing {

  constructor(workSlot = 10, longTime = 20000, pauseTime = 20) {
    this.workSlot = workSlot;
    this.longTime = longTime;
    this.pauseTime = pauseTime;
    this.interrupted = false;
    this.fatalTimeout = false;
    this.maxCalls = 1000;
    this.reset();
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async pause() {
    if (this.interrupted) throw new TimingException("Timing: interrupted");
    let now = Date.now();
    this.calls++;
    let sinceLastCall = now - this.lastCall;
    if (sinceLastCall > this.workSlot && this.calls > 1000) {
      // low resolution (100ms) timer? Let's cap approximating by calls number
      this.maxCalls = this.calls / sinceLastCall * this.workSlot;
    }
    this.lastCall = now;
    this.elapsed = now - this.timeOrigin;
    if (now - this.lastPause > this.workSlot || this.calls > this.maxCalls) {
      this.tooLong = this.elapsed >= this.longTime;
      if (this.tooLong && this.fatalTimeout) {
        throw new TimingException(`Timing: exceeded ${this.longTime}ms timeout`);
      }
      this.calls = 0;
      if (this.pauseTime > 0) await Timing.sleep(this.pauseTime);
      this.lastPause = Date.now();
      return true;
    }
    return false;
  }

  reset() {
    this.elapsed = 0;
    this.calls = 0;
    this.timeOrigin = this.lastPause = this.lastCall = Date.now();
    this.tooLong = false;
  }
}

class TimingException extends Error {};
