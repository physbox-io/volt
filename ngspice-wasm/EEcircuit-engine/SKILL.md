# Working with EEcircuit-engine

Patterns and traps for agents working on the engine or on code that drives it. How it works and how to build it is in [GUIDE.md](GUIDE.md); read that first.

## 1. A run that never returns, or returns nothing

`runSim()` issues ngspice commands synchronously (`eesim_command`), so it cannot hang waiting on a yield the way the old asyncify build could.

- **Empty result (`{}`)**: ngspice wrote no `out.raw`. The reason is in `getError()` — usually a netlist it refused ("unknown model type", a singular matrix, a missing node). Fix the netlist, not the engine.
- **A run that takes forever**: it is ngspice still solving (a stiff circuit, a timestep that keeps shrinking). It cannot be interrupted mid-transient; Volt's worker discards the engine on its timeout and starts a fresh one.
- **Results from a previous run**: check the plot name, not just whether data came back — Volt's worker does (`EXPECTED_PLOT` in `simDiagnostics.ts`).

## 2. Options persist between runs

One `Simulation` is one ngspice instance, and `.options` stick. A netlist that sets `interp`, `method=gear` or a tolerance changes every netlist run after it on the same engine. Don't put `.options` in a netlist unless every later run should have them; in a benchmark, give each variant its own engine (in its own worker thread — the emscripten glue is a process-wide global).

## 3. Debugging Linked Frontend Dependencies

### The Vite Cache Trap
When modifying the engine (`EEcircuit-engine`) and testing in the `frontend` via a local link (`file:` or `npm link`), Vite often serves stale cached versions of the engine's UMD/ESM bundle.

### Troubleshooting Steps
1. Rebuild the engine: `npm run build` in `EEcircuit-engine`.
2. Clear Vite cache: `rm -rf node_modules/.vite` at the repo root.
3. Restart dev server: `npm run dev`.

## 4. UI/UX for Looping Animations

### Persistent Simulation State
For circuits with time-series data (Scope, LED animations), the UI should remain in "Simulation Mode" even after the mathematical simulation has finished.

### Implementation
- **DO NOT** call `setIsSimulating(false)` immediately after `runSim()` returns if the components rely on that state to loop through animation frames.
- **DO** rely on a manual `Stop` button to clear simulation data and reset `isSimulating`.

## 5. Performance

- Measure warm (after ~100 runs) and interleaved; single cold timings drift by 50%.
- Don't add a per-timestep call into JS from C: an intermediate build that did was 1.7× slower than the old engine. Per-point cost now is real solver work.
- The build's flags and patches live in `Docker/build-wasm.sh`; GUIDE.md says what each one buys.
