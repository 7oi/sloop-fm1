#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Run after python3 tools/build_preview.py; no FM-1 or JieLi SDK required.
set -eu
cd "$(dirname "$0")/.."
[ -f build/preview/sloop-preview.wasm ] || { echo 'Run python3 tools/build_preview.py first'; exit 1; }
mkdir -p build/host
"${CC:-cc}" -O2 -fwrapv -fno-strict-aliasing -w -Ibuild/gen -Ifirmware/src tests/preview_native.c -o build/host/preview_native
node tests/preview_test.mjs
