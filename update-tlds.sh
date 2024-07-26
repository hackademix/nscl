#!/bin/bash

# Copyright (C) 2021-2023 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

# This script updates common/tld.js with the latest pubblic suffix
# and commits the changes if we've got the right git credentials

BASE="$(dirname "$0")"
SRC="$(realpath "$(dirname "$BASE")")"
REL_JS_PATH="common/tld.js"
if node "$BASE/TLD/update.js" $@; then
  echo "Updated TLDs"
else
  exit
fi
if [[ -f "$1" ]]; then
  # Updated out-of-tree $1, nothing more to do.
  exit
fi

if [[ $(git config --get user.name) == "hackademix" ]]; then
  echo "Synchronizing nscl git repo."
  pushd "$BASE"
  if git status --short | grep " M $REL_JS_PATH"; then
    git add "$REL_JS_PATH"
    git add "TLD/public_suffix_list.dat"
    git commit -m'Updated TLDs.'
  else
    echo "Repo already up-to-date."
  fi
  popd
fi
