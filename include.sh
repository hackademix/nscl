#!/bin/bash

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
SRC="$(realpath "$(dirname "$0")/..")"

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
  for f in $(egrep 'nscl/[0-9a-zA-Z_/-]+\.js' **/*.{js,html} "$@" | \
            tr "'\"" "\n" | \
            sed -re 's/.*(nscl\/[0-9a-zA-Z_\/-]+\.js).*/\1/' | \
            egrep '^nscl/[0-9a-zA-Z_/-]+\.js' | sort | uniq); do
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

filter_inclusions "$TARGET" manifest.json
# include also references from nscl scripts already included
[[ -d "$TARGET/nscl" ]] && filter_inclusions "$TARGET/nscl/"
exit 0
