# Circuit Expt (Electronics Playground)

A high-fidelity, interactive electronics playground built with React and powered by an optimized Ngspice WebAssembly engine.

> [!IMPORTANT]
> **DEVELOPER KNOWLEDGE BASE**: Before making any changes or adding components, please read **[docs/knowledge.md](docs/knowledge.md)**. This file contains the "Source of Truth" for the architecture, state management (e.g. `isSimulating`), and real-time animation patterns.

## 🚀 Tech Stack

- **Frontend**: [React](https://reactjs.org/) + [React Flow](https://reactflow.dev/) for the visual circuit editor.
- **Styling**: Vanilla CSS for flexibility and performance.
- **Simulation Engine**: [Ngspice](https://ngspice.sourceforge.io/) (C) compiled to **WebAssembly**.
- **Engine Bridge**: `eecircuit-engine` - a custom TypeScript wrapper for the WASM simulation stack.

## 📂 Project Structure

- `src/`: The React application containing the UI, component library, and circuit logic.
- `ngspice-wasm/EEcircuit-engine/`: The TypeScript wrapper for the Ngspice WASM module.
- `ngspice-wasm/ngspice-ngspice/`: The original C source code and build infrastructure for Ngspice.

## 🛠️ Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Installation

1. **Install Engine Dependencies**:
   ```bash
   cd ngspice-wasm/EEcircuit-engine
   npm install
   npm run build
   ```

2. **Install Frontend Dependencies** (from the repo root):
   ```bash
   cd ../..
   npm install
   ```

### Running the Application

Start the development server from the repo root:
```bash
npm run dev
```
The application will be available at `http://localhost:5174`.

## 🧪 Testing

The simulation engine includes a regression test suite to ensure the WASM bridge remains stable.

```bash
cd ngspice-wasm/EEcircuit-engine
# Run all tests
npm test
# Run specific async-hang prevention test
npm run test:hang
```

## 📘 Documentation

- **[GUIDE.md](ngspice-wasm/EEcircuit-engine/GUIDE.md)**: Technical details on the WASM compilation, Asyncify fixes, and simulation lifecycle.
- **[SKILL.md](ngspice-wasm/EEcircuit-engine/SKILL.md)**: Debugging patterns and maintenance tips for working with the simulation engine.

## 🔧 Custom Modifications

We have heavily modified the original Ngspice-WASM baseline to support:
- **Synchronized Async Bridge**: Eliminated simulation hangs by correctly `await`ing JavaScript handlers in the WASM stack.
- **State-Gated Event Handling**: Optimized initialization vs. simulation phases.
- **Real-time Animation**: Supported looping simulation results in the UI for components like LEDs and Oscilloscopes.

---

## 📜 License

Distributed under the **PhysBox Permissive Public License (PPPL-1.0)**.

Free for personal, academic, educational, research, and commercial use, including the
commercial sale of anything you produce with it — schematics, netlists, simulation
results, and PCB layouts. Attribution must be retained. Redistributing, re-branding,
or hosting the software itself as a standalone or competing product or SaaS requires
prior written authorization. See [LICENSE](LICENSE) for full terms, including the
electrical and hardware safety disclaimer.
