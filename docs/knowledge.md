# Circuit Expt: Knowledge Base & Developer Guide

This document is the source of truth for the **Circuit Expt** electronics playground. It contains architectural patterns, technical state management details, and user design preferences.

## 🚀 Project Overview
- **Core Identity**: An experimental electronics playground for discovery and learning.
- **Domain**: `circuit.expt.in`
- **Tech Stack**: React, React Flow (Canvas), `@tscircuit/ngspice-spice-engine` (WASM-based ngspice), Vite, Vanilla CSS.
- **Font**: Outfit (Google Fonts).

---

## 🛠 Simulation Architecture (ngspice-wasm)

### 1. Two-Pass Simulation (MCU Integration)
To support Microcontrollers (MCUs) that "read" voltages:
- **Pass 1**: Run a standard simulation.
- **Pass 2**: Extract voltages at MCU input pins from Pass 1, feed them into the MCU sandbox, capture the output waveforms, and re-run the SPICE simulation with the MCU outputs as PWL (Piecewise Linear) voltage sources.

### 2. Solving "Singular Matrix" Errors
ngspice-wasm is sensitive to floating nodes. 
- **Rule**: Every handle that might be unconnected should have a high-impedance shunt (e.g., `1G`) to ground in `src/utils/spice.ts`.
- **Example**: 7-Segment segment pins and the common pin all have `1G` shunts.

---

## 📊 Digital Signal Processing (DSP)

### 1. FFT Implementation (`src/utils/fft.ts`)
The Oscilloscope includes a pure JavaScript FFT implementation to avoid large dependencies.
- **Algorithm**: Radix-2 Cooley-Tukey (Fast Fourier Transform).
- **Windowing**: Uses a **Hanning Window** to reduce spectral leakage (especially important for non-periodic signal snapshots).
- **Output**: Returns Magnitude (converted to dB) vs Frequency (Hz).
- **Resolution**: Frequency bins are calculated as `fs / N` (where `fs` is the sampling rate and `N` is the buffer size).

### 2. Oscilloscope Scaling
- **Auto-Scaling**: Dynamically computes V/div and Time/div based on the min/max values and time window of the simulation result.
- **Manual Override**: If the user sets values in the Properties panel, these take precedence over the auto-calculated scales.

---

## 🔬 Component SPICE Models

### 1. Potentiometer
Modelled as a **Two-Resistor Voltage Divider**:
- `R_top`: Connected between `in` and `wiper`. Value = `TotalResistance * (1 - WiperPos)`.
- `R_bottom`: Connected between `wiper` and `out`. Value = `TotalResistance * WiperPos`.
- **Wiper Pos**: 0.0 to 1.0 (0% to 100%).
- This model is preferred over a single variable resistor because it correctly handles the 3-terminal voltage divider behavior.

### 2. 7-Segment Display
- **Threshold**: Each segment lights up if `(V_seg - V_common) > 2.5V`.
- **Common Cathode**: Assumes a common cathode configuration (grounding the common pin is standard for presets).
- **Animation**: Captures the full transient array for every segment to show high-frequency switching.

### 3. Current Source
- Uses the native ngspice `I` device.
- Configurable `value` in Amperes (A).
- Essential for current mirrors and active biasing circuits.

---

## 🔧 Technical State Management

### 1. `isSimulating` Flag & Animation
The global `isSimulating` state in `App.tsx` controls the "Active" status of the playground.
- **Syncing**: A `useEffect` in `App.tsx` watches `isSimulating` and syncs it to every node's `data` object.
- **Result Processing**: During `runSimulation`, the `updatedNodes` are explicitly initialized with `data.isSimulating: true` to ensure animations start immediately upon receiving data.
- **Gating**: Components like `LEDNode` and `SevenSegmentNode` use this flag to start/stop their `requestAnimationFrame` loops.

### 2. Node Data Schema (Standard Fields)
- `current_array`: `number[]` - Amperage through component over time.
- `time_points`: `number[]` - Timestamps (ms).
- `voltageData`: `{t: number, v: number}[]` - Used for Scope/Speaker charting.
- `segmentVoltageArrays`: `Record<string, number[]>` - Per-segment series for 7-Seg.
- `isSimulating`: `boolean` - Controls animation loops.

### 3. Animation Loop Implementation
Components use a "replay" loop that cycles through simulation data:
```typescript
useEffect(() => {
  if (!isSimulating || !data.time_points) return;
  
  let startTime = Date.now();
  const duration = data.time_points[data.time_points.length - 1]; // usually 1000ms
  
  const animate = () => {
    let elapsed = (Date.now() - startTime) % duration;
    // 1. Index lookup in time_points
    // 2. State update (voltages/current)
    // 3. requestAnimationFrame(animate)
  };
}, [isSimulating, data.time_points]);
```

---

## 🎨 User Preferences & UI Design

### 1. Aesthetic: "Electronics Playground"
- **Style**: Dark mode, vibrant handle colors, modern Outfit typography.
- **Persistence**: Settings (Aura, Resolution, Length) and User Presets are saved to `localStorage` automatically.

### 2. Interaction Patterns
- **Bidirectional Handles**: Define both `source` and `target` Handles for the same ID/position.
- **Probe Mode**: Crosshair tool for real-time voltage tooltips on wires after simulation.
- **Datasheets**: Technical reference panels integrated into the sidebar properties panel (`src/utils/datasheets.ts`).

---

## 🔬 Advanced UI & Diagnostic Tools

### 1. Probe Mode (Voltage Tooltip)
- **Logic**: When active, edge clicks look up the `portToNet` map.
- **Data Source**: Fetches the **final value** of the net voltage from the `simResultRef` stored in `App.tsx`.
- **UX**: Displays a floating violet tooltip with the Net name and current Voltage.

### 2. Technical Datasheets (`src/utils/datasheets.ts`)
The sidebar properties panel dynamically injects a "Datasheet" section based on the node's `type`.
- **Schema**:
  - `description`: Overview of component function.
  - `workingPrinciple`: Physics/logic behind it.
  - `keyFormulas`: Markdown-formatted formulas.
  - `specs`: Typical operating ranges.
  - `truthTable`: (For Logic Gates) Array-based truth table rendering.

### 3. Node Resizing
- **NodeResizer**: Integrated via React Flow to allow the Oscilloscope to be dynamically resized on the canvas.
- **State Sync**: Resizing updates the `width` and `height` in the node's `data` object for persistence.

---

## 🔬 Debugging & Development
- **Isolated Testing**: Use `npx tsx src/utils/mcu.ts` or standalone `.mjs` files to test logic (like PWL generation) outside the browser.
- **Ref Updates**: For high-frequency visual updates (glow, text), use `useRef` and direct DOM manipulation inside `requestAnimationFrame` to avoid React re-render overhead.

---

## 🔌 MCP WebSocket & Documentation Sync

### WebSocket Role Reversal
To support local development and standalone static deployment configurations:
1. The **local companion server** (`~/expt_mcp/server.py` or `server.mjs`) hosts a WebSocket server on port `3142`.
2. The **browser React app** connects as a client to `ws://localhost:3142`.
3. The companion server acts as a bridge, routing tool calls from MCP clients (e.g. Claude) over WebSocket to the browser simulation, returning SPICE outputs dynamically.

### Keeping Documentation & Schemas in Sync
If component types, data fields, or simulation actions in the React app change, you MUST update:
1. **`mcp-docs.json`** at the root of this repository (`circuit/mcp-docs.json`).
2. **`mcp-docs/circuit.json`** inside the MCP server repository (`expt_mcp/mcp-docs/circuit.json`). This is a fallback copy committed to the MCP repo so users can run it standalone without cloning the simulator.

If you also change React hook commands:
- Update **`src/hooks/useMCPBridge.ts`** to handle the command and map it to canvas nodes/wires.

