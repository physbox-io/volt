# Skill: Debugging and Maintaining Ngspice-WASM Simulation Engines

This document provides a set of patterns and troubleshooting techniques for AI agents working with the `EEcircuit-engine` and its underlying Ngspice-WASM bridge.

## 1. Identifying the "Hanging Bridge" Pattern

### Symptom
The simulation starts, the CPU spikes, but no results are returned. In the console, you see repeated logs like `C code called handleThings!` but the simulation never progresses.

### Root Cause: Unresolved Promises
The engine uses `EM_ASYNC_JS` to pause C execution and yield to the JavaScript event loop. If the JS callback (`handleThings`) is called within a Promise that doesn't resolve, the C stack remains suspended forever.

### Fix
Ensure that every path through the `EM_ASYNC_JS` bridge correctly `resolve()`s. In this repo, the bridge was fixed by `await`ing the `handleThings` function in the glue code:
```javascript
// Inside spice.js / Docker/run.sh bridge injection
await Module.handleThings();
```

## 2. Managing the Simulation Lifecycle

### Initialization vs. Run Phase
The C engine yields frequently. It is critical to distinguish between:
1. **Startup Yields**: Occur during `source` command processing or internal initialization.
2. **Simulation Yields**: Occur during the actual transient analysis run.

### The `hasStartedCommands` Pattern
Use a state flag to gate result processing. Do not attempt to read `out.raw` or resolve the simulation promise until the engine has moved past the initial command queue:
```typescript
if (this.cmd === 0 && this.initialized && this.hasStartedCommands) {
    // Read results only now
}
```

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

## 5. C-to-JS Bridge Injection

The WASM bridge is often injected during the build process via `sed` or `patch`. 
- **Location**: `Docker/run.sh` or similar build scripts.
- **Pattern**: Look for `EM_ASYNC_JS` macros and ensure they align with the expected signature of the JS handler in `simulationLink.ts`.
