#!/bin/bash

# This script includes in the $TARGET/nscl directory
# any nscl JS file referenced by $TARGET/manifest.json
# or any *.js file found under $TARGET, plus those
# referenced by the nscl files included in the first pass
export TARGET="$1"
export SRC="$(dirname $0)/.."
if ! [[ "$SRC" == /* ]]; then
  SRC="$(pwd)/$SRC"
fi
if ! [[ "$TARGET" && -d "$TARGET" ]]; then
  echo 1>&2 "Target directory '$TARGET' not found!"
  exit 1
fi
[[ -d "$TARGET/nscl" ]] && rm -rf "$TARGET"/nscl/**

filter_inclusions() {
  echo "Processing inclusions referenced by $@..."
  pushd >/dev/null 2>&1 "$1"
  shift
  shopt -s globstar
  for f in $(egrep 'nscl/[0-9a-zA-Z_/-]+\.js' **/*.js $@ | \
            tr "'\"" "\n" | \
            sed -re 's/.*(nscl\/[0-9a-zA-Z_\/-]+\.js).*/\1/' | \
            egrep '^nscl/[0-9a-zA-Z_/-]+\.js' | sort | uniq); do
    if ! [[ -f "$TARGET/$f" ]]; then
      nscl_curdir="$TARGET/$(dirname $f)"
      mkdir -p "$nscl_curdir"
      cp -p "$SRC/$f" "$nscl_curdir"
      echo "Including $f."
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