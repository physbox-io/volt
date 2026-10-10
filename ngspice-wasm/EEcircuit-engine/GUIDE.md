# EEcircuit-engine: how it works and how to build it

This package is ngspice, with XSPICE, compiled to WebAssembly and wrapped in a small TypeScript class (`Simulation` in `src/simulationLink.ts`) with one job: take a netlist, run it, hand back the vectors.

## How a run happens

ngspice is built as its **shared-library API** (`--with-ngshared`) rather than as the interactive program. `Docker/eesim/eesim.c` exports two entry points to JS:

- `eesim_init()` — once, at `start()`. Initialises ngspice with callbacks that pass its console output to `Module.eesimPrint(line, isErr)`, which feeds `getInfo()` and, through the same filter as before, `getError()`.
- `eesim_command(cmd)` — synchronous. `runSim()` writes the netlist to `/test.cir` in the emscripten FS and issues `source /test.cir`, `destroy all`, `run`, `write out.raw` (plus `setplot noise1` for a `.noise` netlist), then reads `out.raw` back and parses it (`src/readOutput.ts`). Each call returns when ngspice has finished the command.

Because every call returns, the module needs **no asyncify** and no command loop paused between runs. Things worth knowing:

- **One ngspice instance per `Simulation`.** `.options` set by one netlist persist into the next one run on the same instance — a benchmark that sets `interp` or `method=gear` changes every later run.
- **A run cannot be interrupted mid-transient.** Volt's worker enforces its timeout by discarding the engine (see `src/workers/simulation.worker.ts`).
- **No raw file means `{}`.** A circuit ngspice refuses resolves with an empty result (and its reasons in `getError()`) rather than hanging; Volt's worker treats that as a failure.
- **Warm-up.** A fresh module solves its first ~100 runs at about 2.5× the cost of later ones while the wasm is compiled up to speed. Volt's worker warms it at startup.
- **One engine per JS realm when benchmarking.** The emscripten glue installs a process-wide global, so loading two builds in one process measures whichever loaded last. Compare builds in separate worker threads.

Before this, the engine drove ngspice's interactive `stdin` loop and suspended the C stack with asyncify between commands, through a `window.prompt` hijack in `pre.js`. That design, its hang fixes and the per-timestep yield into JS are gone; together with two bookkeeping costs below they made each solver point about 3× slower than now.

## What each transient point costs, and why

Measured warm, 40ms slices of Volt presets, median µs per point (2026-10-09):

| circuit | asyncify build | now |
|---|---|---|
| sineAudio | 11.3 | 3.4 |
| bjtAmp | 14.9 | 5.2 |
| opAmpAmp | 16.0 | 5.8 |
| buckConverter | 20.2 | 7.6 |

Outputs are bit-identical between the two. The gains, in order of size:

- **`set no_mem_check`** (in `src/codemodels/spinit`). ngspice otherwise re-reads `/proc/meminfo` through the emscripten FS on every output point to check memory — about a quarter of each transient.
- **`seconds()` returns 0 under emscripten** (patched by `build-wasm.sh`). It feeds only the run statistics, but was a JS clock read several times per step — about a sixth. `rusage` therefore reports zero times.
- **No asyncify**, via the shared-library API: 10–20%.
- **The per-timestep yield hook is gone.** An intermediate build put it back from the committed ngspice tree and was 1.7× *slower* than the asyncify build; don't reintroduce a per-step call into JS.

Tried and left out: KLU (5–10% slower than Sparse 1.3 at these circuit sizes), `-O3`, `-flto` and `-msimd128` (3% or less; LTO adds 10% to the wasm). What remains is solver work: B-source evaluation (`PTeval`), device loads, Newton iteration, sparse factor/solve.

## Building the Engine

You rarely need to. `src/spice.js` and `src/spice.wasm` are the compiled engine and are committed; CI, the Docker image and a fresh checkout all just run `npm ci && npm run build` here, which bundles them into `dist/` (gitignored). Rebuild the wasm only when the ngspice C source, `Docker/eesim/eesim.c`, `Docker/static-cm/cmstatic.c` or the build flags change, and commit the two outputs.

Both routes run the same script, `Docker/build-wasm.sh`, which configures ngspice as a cross build for `wasm32-unknown-emscripten` with XSPICE and the shared-library API:

```bash
# Without Docker, from the committed tree (ngspice-wasm/ngspice-ngspice), on a copy of it.
# Needs emscripten (built with 5.0.7), python >= 3.10 for emcc (set EMSDK_PYTHON if
# python3 is older), and gcc, autoconf, automake, libtool, bison and flex on PATH.
./build-ngspice-local.sh <emsdk-dir> [work-dir]   # copies spice.js/spice.wasm into src/
npm run build                                     # then rebundle dist/

# With Docker, from a fresh clone of ngspice (github.com/danchitnis/ngspice-sf-mirror)
# under `emsdk install latest`: Docker/run.sh. (Untested since build-wasm.sh replaced its
# inline build — the Docker daemon needs sudo on the dev machine.)
```

A clean build takes about 6 minutes. `OPT`, `CONF_EXTRA` and `LD_EXTRA` in the environment let you try other flags (defaults: `-O2`, none, none).

### XSPICE code models are linked in statically

Native ngspice `dlopen()`s each code-model library (`digital.cm`, `analog.cm`, `xtradev.cm`, `xtraevt.cm`, `table.cm`, `tlines.cm`, `spice2poly.cm`) when spinit runs `codemodel …`. A plain emscripten module cannot `dlopen`, and the `.cm` files this package used to write into the FS were native x86-64 ELF libraries, so every XSPICE model (`adc_bridge`, `dac_bridge`, `d_tff`, `d_and`, …) failed with *"Unknown model type"*. Now `build-wasm.sh` compiles the code models to wasm, archives them as `libcmstatic.a` with `Docker/static-cm/cmstatic.c` (which stands in for each library's `dlmain.c` and registers its device tables), links that into `spice.wasm`, and patches `load_opus` to ask `cmstatic_load` before `dlopen`. spinit's `codemodel` lines therefore keep working with no `.cm` file present. `tests/xspiceDigital.test.ts` in Volt proves it: flip-flop counters, `ic=` start states, and a count carried across two runs.

### What build-wasm.sh patches, and why

- **`seconds()`** returns 0 under emscripten (above).
- **cmpp in a cross build**: `cmpp` is built natively (`CC_FOR_BUILD=gcc`), but the icm makefile ran the wasm `cmpp` for `cmpp -p`, which then lists no models; it is pointed at `$(CMPP)`.
- **`src/xspice/verilog` and `vhdl`** are skipped: they are co-simulation shared libraries libtool will not build for wasm, and nothing uses them.
- **hicum2** removal and the `configure.ac` edits, as `run.sh` always did.

Eight source files the build needs (`src/frontend/parse-bison.y`, `src/spicelib/parser/inpptree-parser.y`, and six under `src/xspice/icm/table/`) are matched by ngspice's own `.gitignore` and are force-added in this repo.

> [!IMPORTANT]
> The `EEcircuit-engine` TypeScript build (`npm run build`) strictly checks types. If you modify `simulationLink.ts` to access undocumented Emscripten FS bindings (like `module.FS.mkdir`), you must use TypeScript overrides (e.g., `(module.FS as any)`) to prevent the build from silently failing and leaving you with an outdated output bundle.

## Testing

`npm test` here runs the package's own regression tests (including the original hang-prevention guard, which now simply confirms a run returns). The tests that matter for Volt are in Volt's `tests/`: `netlistSnapshot`, `sliceCarry`, `analysisEndToEnd`, `electromech`, `sourceContinuity`, `hilSlices`, `xspiceDigital` — run them one file at a time after a rebuild.
