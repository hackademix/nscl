#!/bin/bash

# Copyright (C) 2021-2023 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

# This script updates common/tld.js with the latest pubblic suffix
# and commits the changes if we've got the right git credentials

BASE="$(dirname "$0")"
SRC="$(realpath "$(dirname "$BASE")")"
REL_JS_PATH="common/tld.js"
TARGET_JS_PATH="$1"
if node "$BASE/TLD/update.js" "$TARGET_JS_PATH"; then
  echo "Updated TLDs"
else
  unset TARGET_JS_PATH
fi

if [[ $(git config --get user.name) == "hackademix" ]]; then
  pushd "$BASE"
  [[ $TARGET_JS_PATH ]] && [[ -f "$TARGET_JS_PATH" ]] && cp -f "$TARGET_JS_PATH" "$REL_JS_PATH"
  if git status --short | grep " M $REL_JS_PATH"; then
    git add "$REL_JS_PATH"
    git add "TLD/public_suffix_list.dat"
    git commit -m'Updated TLDs.'
  fi
  popd
fi
