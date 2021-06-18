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

'use strict';
var _ = browser.i18n.getMessage;
var i18n = (() => {
  var i18n = {
    // derived from  http://github.com/piroor/webextensions-lib-l10n

  	updateString(aString) {
  		return aString.replace(/__MSG_(.+?)__/g, function(aMatched) {
  			var key = aMatched.slice(6, -2);
  			return _(key);
  		});
  	},
  	updateDOM(rootNode = document) {
  		var texts = document.evaluate(
  				'descendant::text()[contains(self::text(), "__MSG_")]',
  				rootNode,
  				null,
  				XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
  				null
  			);
  		for (let i = 0, maxi = texts.snapshotLength; i < maxi; i++)
  		{
  			let text = texts.snapshotItem(i);
  			text.nodeValue = this.updateString(text.nodeValue);
  		}

  		var attributes = document.evaluate(
  				'descendant::*/attribute::*[contains(., "__MSG_")]',
  				rootNode,
  				null,
  				XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
  				null
  			);
  		for (let i = 0, maxi = attributes.snapshotLength; i < maxi; i++)
  		{
  			let attribute = attributes.snapshotItem(i);
  			debug('apply', attribute);
  			attribute.value = this.updateString(attribute.value);
  		}
  	}
  };

  if (typeof document === "object") {
		document.addEventListener('DOMContentLoaded', e => i18n.updateDOM());
	}
  return i18n;
})()
