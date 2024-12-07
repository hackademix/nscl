#!/bin/bash

# Copyright (C) 2021-2024 Giorgio Maone <https://maone.net>
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
  if [[ $1 = "-q" ]]; then
     QUIET=1
     shift
  fi
  echo "Processing inclusions referenced by $@..."
  pushd >/dev/null 2>&1 "$1"
  shift
  shopt -s globstar nullglob
  for f in $(grep -Eho '\bnscl/[0-9a-zA-Z_/.-]+\.js(on)?' **/*.{js,html} "$@" | sort | uniq); do
    if ! [[ -f "$TARGET/$f" ]]; then
      nscl_srcdir="$(dirname "$f")"
      # create symlink to actual file if this is a MAIN world alias
      if [[ $nscl_srcdir = */main && ! -f "$SRC/$f" ]]; then
        fname=$(basename $f)
        for alias_dir in */content */common */lib ; do
          echo "$alias_dir $SRC/$alias_dir/$fname"
          if [[ -f "$SRC/$alias_dir/$fname" ]]; then
            symlink_src="../$(basename $alias_dir)/$fname"
            echo "Creating symlink in $nscl_srcdir: $symlink_src -> $SRC/$f..."
            ln -s "$symlink_src" "$SRC/$f"
            break
          fi
        done
      fi
      nscl_curdir="$TARGET/$nscl_srcdir"
      mkdir -p "$nscl_curdir"
      cp -pP "$SRC/$f" "$nscl_curdir"
      echo "Including $f in $nscl_curdir"
    else
      [[ $QUIET ]] || echo >&2 "$TARGET/$f exists!"
    fi
  done
  popd >/dev/null 2>&1
}
# if a service worker is declared in the manifest, we will inspect its script inclusions as well
SERVICE_WORKER=$(grep -e '"service_worker":' "$TARGET/manifest.json" | sed -re 's/.*: "(.*)",?/\1/')
filter_inclusions "$TARGET" manifest.json $SERVICE_WORKER
# include also references from nscl scripts already included
[[ -d "$TARGET/nscl" ]] && filter_inclusions -q "$TARGET/nscl/"

# auto-update TLDs if included
"$BASE/update-tlds.sh" "$TARGET/nscl/common/tld.js"

exit 0
