#!/bin/bash
# Configure and build ngspice to spice.js + spice.wasm with XSPICE and every
# XSPICE code-model library (spice2poly, digital, analog, xtradev, xtraevt,
# table, tlines) linked statically into the module.
#
# Usage: build-wasm.sh <ngspice-source-dir> <output-dir> <pre.js>
#
# Expects emcc/emconfigure/emmake on PATH (emsdk activated) plus autotools,
# bison and flex. The source tree must already carry the eesim_sleep_hack
# patches (run.sh applies them to a fresh clone; ngspice-wasm/ngspice-ngspice
# has them committed). Everything else is applied here and is idempotent.
#
# Why static: native ngspice dlopen()s each <lib>.cm at "codemodel" time.
# A plain emscripten module cannot dlopen, so the code-model objects go into
# spice.wasm and static-cm/cmstatic.c registers a library's device tables
# when spinit's "codemodel /usr/local/lib/ngspice/<lib>.cm" runs (load_opus
# asks cmstatic_load first; no .cm file needs to exist).
set -e

SRC=$(realpath "$1")
OUT=$(realpath -m "$2")
PREJS=$(realpath "$3")
HERE=$(dirname "$(realpath "$0")")
JOBS=${JOBS:-$(nproc)}

cd "$SRC"

echo "build-wasm: patching source"
bash "$HERE/hicum2_patch.sh"
sed -i 's/-Wno-unused-but-set-variable/-Wno-unused-const-variable/g' ./configure.ac
sed -i 's/AC_CHECK_FUNCS(\[time getrusage\])/AC_CHECK_FUNCS(\[time\])/g' ./configure.ac

# The yield hook run on every timestep must just await handleThings, as
# run.sh writes it. ngspice-wasm/ngspice-ngspice carries a variant that also
# waits on setTimeout(resolve, 0) - a >=1ms timer per timestep in node, which
# makes transients ~12x slower. Normalise it to the run.sh form.
perl -0pi -e 's/await new Promise\(\(resolve\) => \{\s*Module\["handleThings"\]\(\);\s*setTimeout\(resolve, 0\);\s*\}\);/await Module["handleThings"]();/' src/frontend/control.c
grep -q 'eesim_sleep_hack' src/frontend/control.c
! grep -q 'setTimeout' src/frontend/control.c

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
emconfigure ../configure --build="$(../config.guess)" --host=wasm32-unknown-emscripten CC_FOR_BUILD=gcc \
  --disable-debug --disable-openmp --enable-xspice --disable-shared --disable-osdi --without-x --with-readline=no

# verilog/ and vhdl/ only hold the co-simulation shims (shared libraries for
# d_cosim), which libtool refuses to build for a wasm host. Skip them.
sed -i -E 's/^(SUBDIRS = .*) verilog vhdl$/\1/' src/xspice/Makefile
grep -q '^SUBDIRS = .*icm$' src/xspice/Makefile

ICM="$PWD/src/xspice/icm"
sed -i "s|\$(ngspice_LDADD) \$(LIBS)|\$(ngspice_LDADD) $ICM/libcmstatic.a \$(LIBS) -O2 -s ASYNCIFY=1 -s ASYNCIFY_ADVISE=0 -s ASYNCIFY_IGNORE_INDIRECT=0 -s ENVIRONMENT=\"web,worker\" -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORTED_RUNTIME_METHODS=[\"FS\",\"Asyncify\",\"callMain\"] --pre-js $PREJS -o spice.mjs|g" ./src/Makefile
grep -q libcmstatic.a ./src/Makefile

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

echo "build-wasm: building ngspice"
emmake make -j"$JOBS"

mkdir -p "$OUT"
cp src/spice.mjs "$OUT/spice.js"
cp src/spice.wasm "$OUT/spice.wasm"
echo "build-wasm: wrote $OUT/spice.js and $OUT/spice.wasm"
