#!/bin/bash

# Copyright (C) 2021-2023 Giorgio Maone <https://maone.net>
#
# SPDX-License-Identifier: GPL-3.0-or-later

# This script includes in the $TARGET/nscl directory
# any nscl JS file referenced by $TARGET/manifest.json
# or any *.js file found under $TARGET, plus those
# referenced by the nscl files included in the first pass

TARGET="$1"
if [[ -z "$TARGET" ]];then
  echo 1>&2 "Target directory not specified!"
  exit 1
fi
TARGET="$(realpath "$TARGET")"
BASE="$(dirname "$0")"
SRC="$(realpath "$(dirname "$BASE")")"

if ! [[ -d "$TARGET" ]]; then
  echo 1>&2 "Target directory '$TARGET' not found!"
  exit 1
fi
[[ -d "$TARGET/nscl" ]] && rm -rf "$TARGET"/nscl/**

filter_inclusions() {
  echo "Processing inclusions referenced by $@..."
  pushd >/dev/null 2>&1 "$1"
  shift
  shopt -s globstar nullglob
  for f in $(grep -E 'nscl/[0-9a-zA-Z_/-]+\.js' **/*.{js,html} "$@" | \
            tr "'\"" "\n" | \
            sed -re 's/.*(nscl\/[0-9a-zA-Z_\/-]+\.js).*/\1/' | \
            grep -E '^nscl/[0-9a-zA-Z_/-]+\.js' | sort | uniq); do
    if ! [[ -f "$TARGET/$f" ]]; then
      nscl_curdir="$TARGET/$(dirname "$f")"
      mkdir -p "$nscl_curdir"
      cp -p "$SRC/$f" "$nscl_curdir"
      echo "Including $f. in $nscl_curdir"
    else
      echo >&2 "$TARGET/$f exists!"
    fi
  done
  popd >/dev/null 2>&1
}
# if a service worker is declared in the manifest, we will inspect its script inclusions as well
SERVICE_WORKER=$(grep -e '"service_worker":' "$TARGET/manifest.json" | sed -re 's/.*: "(.*)",?/\1/')
filter_inclusions "$TARGET" manifest.json $SERVICE_WORKER
# include also references from nscl scripts already included
[[ -d "$TARGET/nscl" ]] && filter_inclusions "$TARGET/nscl/"

# auto-update TLDs if included
"$BASE/update-tlds.sh" "$TARGET/nscl/common/tld.js"

exit 0
