#!/bin/bash
# Build spice.js/spice.wasm without Docker, from the committed ngspice tree
# (../ngspice-ngspice), and copy them into src/.
#
# Usage: ./build-ngspice-local.sh <emsdk-dir> [work-dir]
#
# Needs an activated-able emsdk (tested with emscripten 5.0.7), python >= 3.10
# for emcc (set EMSDK_PYTHON if the default python3 is older), gcc, autoconf,
# automake, libtool, bison and flex on PATH. The source tree is copied to
# work-dir (default: a mktemp dir) so the committed tree is never modified.
set -e

HERE=$(dirname "$(realpath "$0")")
EMSDK_DIR=$(realpath "${1:?usage: $0 <emsdk-dir> [work-dir]}")
WORK=${2:-$(mktemp -d)}
WORK=$(realpath -m "$WORK")

export EMSDK="$EMSDK_DIR"
export EM_CONFIG="$EMSDK_DIR/.emscripten"
NODE_BIN=$(ls -d "$EMSDK_DIR"/node/*/bin | head -n 1)
export PATH="$EMSDK_DIR/upstream/emscripten:$NODE_BIN:$PATH"
emcc --version | head -n 1

rm -rf "$WORK/ngspice"
mkdir -p "$WORK"
cp -a "$HERE/../ngspice-ngspice" "$WORK/ngspice"

bash "$HERE/Docker/build-wasm.sh" "$WORK/ngspice" "$WORK/out"

cp "$WORK/out/spice.js" "$HERE/src/spice.js"
cp "$WORK/out/spice.wasm" "$HERE/src/spice.wasm"
echo "build: copied spice.js and spice.wasm to $HERE/src"
