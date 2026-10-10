#!/bin/bash
# Configure and build ngspice to spice.js + spice.wasm: ngspice's shared-library
# API (--with-ngshared) driven synchronously from JS through eesim/eesim.c, with
# XSPICE and every code-model library (spice2poly, digital, analog, xtradev,
# xtraevt, table, tlines) linked statically into the module.
#
# Usage: build-wasm.sh <ngspice-source-dir> <output-dir>
#
# Tunables (environment):
#   OPT        compile + link optimisation flags   (default: -O2)
#   CONF_EXTRA extra ./configure arguments         (default: none)
#   LD_EXTRA   extra emcc link arguments           (default: none)
#
# Expects emcc/emconfigure/emmake on PATH (emsdk activated) plus autotools,
# bison and flex. Works on a fresh ngspice clone or on ngspice-wasm/ngspice-
# ngspice; every patch below is idempotent.
#
# Why synchronous: the old build ran ngspice's interactive command loop and
# paused it between runs with asyncify, which instruments the whole binary.
# ngSpice_Command() returns when a command is done, so no asyncify is needed.
#
# Why static code models: native ngspice dlopen()s each <lib>.cm. A plain
# emscripten module cannot dlopen, so the code-model objects go into
# spice.wasm and static-cm/cmstatic.c registers a library's device tables
# when spinit's "codemodel /usr/local/lib/ngspice/<lib>.cm" runs (load_opus
# asks cmstatic_load first; no .cm file needs to exist).
set -e

SRC=$(realpath "$1")
OUT=$(realpath -m "$2")
HERE=$(dirname "$(realpath "$0")")
JOBS=${JOBS:-$(nproc)}
OPT=${OPT:--O2}

cd "$SRC"

echo "build-wasm: patching source (OPT='$OPT' CONF_EXTRA='$CONF_EXTRA' LD_EXTRA='$LD_EXTRA')"
bash "$HERE/hicum2_patch.sh"
sed -i 's/-Wno-unused-but-set-variable/-Wno-unused-const-variable/g' ./configure.ac
sed -i 's/AC_CHECK_FUNCS(\[time getrusage\])/AC_CHECK_FUNCS(\[time\])/g' ./configure.ac

# Drop the asyncify yield hook (eesim_sleep_hack) of the interactive build,
# wherever an older patch put it.
perl -0pi -e 's/#include <emscripten.h>\s*EM_ASYNC_JS\(void, eesim_sleep_hack, \(\), \{.*?\n\}\);\s*//s; s/[ \t]*eesim_sleep_hack\(\);\s*\n//g' src/frontend/control.c
perl -0pi -e 's/#include <emscripten.h>\nextern void eesim_sleep_hack\(void\);\n//g; s/[ \t]*eesim_sleep_hack\(\);\s*\n//g' src/spicelib/analysis/dctran.c src/spicelib/analysis/cktop.c
! grep -q eesim_sleep_hack src/frontend/control.c src/spicelib/analysis/dctran.c src/spicelib/analysis/cktop.c

# seconds() (SPfrontEnd->IFseconds) feeds only the run statistics ("rusage"),
# yet NIiter, CKTload, CKTtrunc and DCtran call it several times a timestep,
# and in wasm each call is a JS clock read: ~16% of a transient. Return 0.
if ! grep -q 'EESIM_NO_CLOCK' src/misc/misc_time.c; then
  perl -0pi -e 's/(double\nseconds\(void\)\n\{\n)#ifdef USE_OMP/$1#if defined(__EMSCRIPTEN__) \/* EESIM_NO_CLOCK: statistics only *\/\n    return 0.0;\n#elif defined(USE_OMP)/' src/misc/misc_time.c
fi
grep -q 'EESIM_NO_CLOCK' src/misc/misc_time.c

# Code models: in a cross build cmpp is built natively as cmpp/build/cmpp, but
# the icm makefile still runs the target (wasm) cmpp for "cmpp -p", which then
# lists no models. Use $(CMPP), which configure points at the right one.
sed -i 's|^    cmpp = ../cmpp/cmpp$|    cmpp = $(CMPP)|' src/xspice/icm/GNUmakefile.in
grep -q '^    cmpp = $(CMPP)$' src/xspice/icm/GNUmakefile.in

# load_opus: try the statically linked libraries before dlopen.
if ! grep -q cmstatic_load src/spicelib/devices/dev.c; then
  sed -i 's|^    lib = dlopen(name, RTLD_NOW);|#ifdef __EMSCRIPTEN__\n    {\n        extern int cmstatic_load(const char *);\n        int rc_static = cmstatic_load(name);\n        if (rc_static >= 0)\n            return rc_static;\n    }\n#endif\n    lib = dlopen(name, RTLD_NOW);|' src/spicelib/devices/dev.c
fi
grep -q cmstatic_load src/spicelib/devices/dev.c

echo "build-wasm: autogen + configure"
./autogen.sh
rm -rf release
mkdir release
cd release
# configure's own CFLAGS default is "-O2 -s" plus warnings; keep the warnings,
# swap the optimisation level.
emconfigure ../configure --build="$(../config.guess)" --host=wasm32-unknown-emscripten CC_FOR_BUILD=gcc \
  --with-ngshared --disable-debug --disable-openmp --enable-xspice --disable-shared --disable-osdi \
  --without-x --with-readline=no $CONF_EXTRA
sed -i -E "s/^CFLAGS = -O2 -s /CFLAGS = $OPT /" $(find . -name Makefile) src/xspice/icm/makedefs
grep -q "^CFLAGS = $OPT " src/Makefile

# --with-ngshared makes libtool build every object and libngspice itself
# -shared, which it refuses for a wasm host. Build them static (libngspice.a);
# the module is linked from it below.
sed -i -E 's/^STATIC = -shared$/STATIC = -static/' $(find . -name Makefile)
sed -i -E 's/^libngspice_la_CFLAGS = -shared$/libngspice_la_CFLAGS =/; s/^libngspice_la_LDFLAGS = -shared /libngspice_la_LDFLAGS = /' src/Makefile
! grep -rqE '^STATIC = -shared$' --include=Makefile .

# verilog/ and vhdl/ only hold the co-simulation shims (shared libraries for
# d_cosim), which libtool refuses to build for a wasm host. Skip them.
sed -i -E 's/^(SUBDIRS = .*) verilog vhdl$/\1/' src/xspice/Makefile
grep -q '^SUBDIRS = .*icm$' src/xspice/Makefile

ICM="$PWD/src/xspice/icm"

echo "build-wasm: building code models"
emmake make -C src/xspice/cmpp -j"$JOBS"
emmake make -C src/xspice/icm -j"$JOBS"

CFLAGS=$(sed -n 's/^CFLAGS = //p' "$ICM/makedefs")
( cd "$ICM"
  emcc $CFLAGS -Wno-missing-prototypes -I. -I../../include -I"$SRC/src/include" -c "$HERE/static-cm/cmstatic.c" -o cmstatic.o
  OBJS=$(ls cmstatic.o tline_common.o msline_common.o */*/cfunc.o */*/ifspec.o $(ls */*/udnfunc.o 2>/dev/null))
  rm -f libcmstatic.a
  emar rcs libcmstatic.a $OBJS
  echo "build-wasm: libcmstatic.a has $(echo $OBJS | wc -w) objects" )

echo "build-wasm: building libngspice"
emmake make -j"$JOBS"
test -f src/.libs/libngspice.a

echo "build-wasm: linking"
emcc $OPT -I"$SRC/src/include" -c "$HERE/eesim/eesim.c" -o src/eesim.o
emcc $OPT src/eesim.o src/.libs/libngspice.a "$ICM/libcmstatic.a" -lm $LD_EXTRA \
  -s ENVIRONMENT="web,worker" -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -s EXPORTED_FUNCTIONS='["_eesim_init","_eesim_command","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["FS","ccall","cwrap"]' \
  -o src/spice.mjs

mkdir -p "$OUT"
cp src/spice.mjs "$OUT/spice.js"
cp src/spice.wasm "$OUT/spice.wasm"
echo "build-wasm: wrote $OUT/spice.js and $OUT/spice.wasm"
