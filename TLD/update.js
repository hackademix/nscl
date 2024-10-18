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

var fs = require('fs');
var path = require('path');
var https = require('https');
var punycode = require('punycode');

const args = process.argv.slice(2);
const TLD_URL = `https://publicsuffix.org/list/public_suffix_list.dat`;
const TLD_OUT = args[0] || "../common/tld.js";
// If an output file has been specified, we will write the downloaded dat file
// to args[1] if present, otherwise we will discard it.
const DAT_OUT = args[1] || args[0] ? "" : "public_suffix_list.dat";

const offlineTldDat = process.env.NSCL_TLD_DAT ? path.resolve(process.env.NSCL_TLD_DAT) : null;

process.chdir(__dirname);

let ts = Date.now();

if (offlineTldDat) {
  console.log(`Updating tld.js from ${offlineTldDat} ...`);
  parse(fs.readFileSync(offlineTldDat, 'utf8'));
}
else {
  let chunks = [];
  https.get(TLD_URL, res => {
    if (res.statusCode !== 200) {
      console.error(`${TLD_URL} status code: ${res.statusCode}`);
      process.exit(2);
    }

    res.on("data", chunk => {
      chunks.push(chunk);
    })
    res.on("end", function() {
      console.log(`${TLD_URL} retrieved in ${Date.now() - ts}ms.`);
      parse(chunks.join(''));
    });
  });
}

function parse(tldData) {
  let section;

  const sections = /^\/\/\s*===BEGIN (ICANN|PRIVATE) DOMAINS===\s*$/;
  const comment  = /^\/\/.*?/;
  const splitter = /(\!|\*\.)?(.+)/;
  const eof = "// ===END PRIVATE DOMAINS===";
  let complete = false;

  const tlds = {};
  console.debug("tldData length", tldData.length);
  for(var line of tldData.split(/[\r\n]/)) {
    line = line.trim();

    if(sections.test(line)) {
      section = sections.exec(line)[1].toLowerCase();
      tlds[section] = {};
      continue;
    }

    if(!section || !splitter.test(line))
      continue;

    if (comment.test(line)) {
      if (line === eof) {
        complete = true;
      }
      continue;
    }

    let parts = splitter.exec(line);
    let tld  = punycode.toASCII(parts[2]),
      level = tld.split(".").length,
      modifier = parts[1];

    if(modifier == "*.") level++;
    if(modifier == "!") level--;

    tlds[section][tld] = level;
  }

  if(!(complete && tlds.icann && tlds.private))
    throw `Error in TLD parser`;

  let tldOut = fs.readFileSync(TLD_OUT, 'utf8');
  let json = JSON.stringify(tlds);
  let exitCode = 1;
  if (!tldOut.includes(json)) {
    tldOut = /^s*\{/.test(tldOut) ? json
        : tldOut.replace(/(\btlds = )\{[^]*?\};/, `$1${json};`);
    fs.writeFileSync(TLD_OUT, tldOut);
    if (DAT_OUT) {
      fs.writeFileSync(DAT_OUT, tldData);
      console.log(`${DAT_OUT} updated.`);
    }
    console.log(`${TLD_OUT} updated!`)
    exitCode = 0;
  } else {
    console.log(`${TLD_OUT} was already up-to-date, nothing to do.`);
  }
  console.log(`TLDs update finished in ${Date.now() - ts}ms`)
  process.exit(exitCode);
};

