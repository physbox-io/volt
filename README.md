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

## 🧭 PCB Layout and Routing

Volt turns a schematic into a **single-sided** milled board: parts on one face,
copper on the other, one layer of traces. On one layer a net can never cross
another net, so almost everything below is about not needing to. The code
lives in `src/utils/pcbExporter.ts` (placement, search, copper, toolpaths) and
`src/utils/pcbRouter.ts` (the maze router). Entry point: `generatePcbLayout()`.

### The pipeline

1. **Nets** — `extractNets()` walks the schematic's edges and groups pins into
   nets. Only physical parts (components and connectors) are placed; symbols
   such as ground and voltage sources contribute connectivity but no footprint.
2. **Placement** — `placeComponents()` normalises the schematic's x/y into the
   board rectangle, then relaxes overlapping courtyards apart. The gap kept
   between courtyards is room for at least one trace plus clearances, scaled by
   a *spread* factor. With auto-sizing on, the seed board is sized from the
   parts' areas and later cropped back to whatever the copper occupies.
3. **Routing** — `routeBoard()` routes every net on a grid (see below).
4. **Attempts** — an unroutable net is usually a space problem, so the layout
   is retried up to three times at spreads 1.0, 1.4 and 1.8, sharing one
   routing budget. Attempts are ranked on overlapping courtyards first, then
   completion: a fully routed board with two parts on top of each other is not
   a board that can be built, so it loses to a partly routed clean one.
5. **Placement search** — only if every attempt failed. See below.
6. **Auto-jumpers** (off by default) — a soldered wire where copper cannot go.
7. **Copper** — each net's pads and traces are unioned into polygons, then
   *flooded* outward in equal steps so neighbouring nets meet in the middle of
   the gap between them and only one isolation channel is milled. Unused pads
   get their own ring so they are cut free of the surrounding foil.
8. **DRC** — no two nets' copper may touch. Any violation is reported, never
   silently shaved.
9. **Toolpaths** — isolation passes around the copper, drills grouped by bit,
   and the profile cut. The profile runs a tool radius outside the board edge,
   and the board is inset so the outermost cut lands on X0Y0.

### The maze router

`routeBoard()` is an A* maze router on a uniform grid (default 0.25 mm).

**Occupancy model.** Each cell records which net's *keep-out* covers it:
`FREE`, a net index, or `CONFLICT` when two or more nets' keep-outs overlap. A
keep-out is stamped at radius `copper + clearance + traceWidth/2`, so a cell is
a legal centre-line for net N exactly when it is `FREE` or owned by N. A trace
is only ever emitted along cells that provably stay `clearance` away from every
other net. Pads on no net, cutouts and the board edge are stamped `CONFLICT`
for everyone. A pad's own copper disc is re-claimed for its net after the
stamping so a pin can always escape, even where a neighbour's keep-out overlaps
it.

**A hard consequence, measured, not assumed:** at 2.54 mm pitch with 1.8 mm
pads, a trace centre must clear 1.5 mm from a pad centre, and the midpoint
between adjacent pads is only 1.27 mm away. No trace can ever pass between
adjacent pins of a header. Every pin escapes perpendicular to its row, on
either side, and reaches anything else by going around the end of the row. A
dual-row module is therefore a pair of walls, and the space between the rows
is routable, because the router keeps out of copper, not of part bodies.

**One net.** Pins are joined along a minimum spanning tree. Each tree edge is
first checked with a plain flood fill (`isReachable`) so a fenced-in pin fails
in about a millisecond rather than after an exhaustive search. If a path
exists, `findPath` runs a multi-source A* from every cell already laid for the
net to the target pad: 8-way movement with octile costs, a bend penalty
(default 1.5 grid steps) charged on every change of direction so the result is
not a staircase, and a rule against diagonal moves that squeeze between two
blocked orthogonal neighbours. The path is collapsed to a polyline and its
keep-out capsule is stamped for the net before the next edge routes.

**All nets.** Routing order decides what fits, so `routeBoard()` tries several
orderings and keeps the best: shortest tree first, longest first, top-down,
bottom-up, left-right; then up to four rip-up passes that move the failed nets
to the front of the order and rotate it; then up to eight deterministic
shuffles. It stops as soon as a pass routes everything or the wall-clock budget
(`routingBudgetMs`, default 8000) is spent. The first pass always runs. The
result is the traces, the connections that could not be made, and
`completion = achieved / required`.

**Linked pairs.** Two pins may be declared joined by something that is not
copper. The spanning tree takes such a pair at zero cost, and no trace is
planned or required for it. This is how a wire jumper is described to the
router.

### The placement search

Whether a single-sided board routes depends heavily on where the parts sit.
On one real four-part carrier board only 7 of 108 hand-tried arrangements
routed. The search runs only after the schematic's own arrangement has failed
at every spread, so a board that already routes pays nothing.

The search is cheap-then-verified. Candidates are generated, ranked by two
increasingly expensive stages, and only the best few are routed for real; a
routed result is the truth, so a ranking mistake costs a wasted routing pass
rather than a wrong answer.

**Candidates.** A candidate is a `PlacementSeed`: a normalised position and a
rotation (0/90/180/270) per part. Structured candidates come first, most useful
first, because the scoring stage is time-bounded and a large board does not
get through them all:

1. one part moved on its own to each cell of a 3×3 grid over the board, each
   way round, with the rest left where they are — the move that fixes a
   connector sitting on the wrong side of a module, and one that no
   rearrangement of the existing slots can express;
2. one part turned in place — a quarter turn decides whether a connector's
   pins escape towards what they connect to; a half turn puts pin 1 at the
   other end of the strip, which decides which way its traces wrap, and for a
   single-row header is the same geometry as mirroring it;
3. two parts swapped between their slots;
4. the whole layout reflected or turned, then combined with the swaps.

Random seeds follow until the scoring deadline (half the routing budget, at
least a second). Every candidate is placed at the tightest spread whose
courtyards do not collide. That fallback matters: the auto-sized seed board is
too small at spread 1.0 to hold a connector on the far side of a long module,
and until the fallback existed every such arrangement was discarded as an
overlap before it was ever scored.

**Stage 1, `scorePlacement()`.** One ordering pass of the real router on a grid
one track pitch wide (`traceWidth + clearance`, 0.8 mm by default), no rip-up,
no budget. Score = unrouted connections × 1000 + trace length × 0.05, lower is
better; length only breaks ties. About 30 ms per candidate on a four-part
board. The best few are then hill-climbed briefly (one part moved or turned at
a time, keeping any improvement).

**Stage 2, `coarseRoutability()`.** The same coarse grid, but the full
`routeBoard()` with all its orderings and rip-up passes, on a budget of about
a twentieth of the routing budget (100–400 ms), for the top dozen candidates.
One pass cannot separate a board that routes from one that very nearly does;
the difference is often one net that needs several others to move first.

**Stage 3.** The top `placementRouteTop` (default 3) candidates, ordered by
coarse completion, then coarse unrouted count, then score, are placed and
routed at full resolution with the full budget. The first that routes
completely wins; otherwise the best attempt seen anywhere is kept.

Why the router itself, and not a formula? Five formulations were tried —
straight-line crossings, wirelength over pad positions, congestion per cell,
escape points with obstacle-aware detours, tracks per cell boundary — and a
hand-built negotiated-congestion router at the same cost. Every one rewarded
compactness: a tightly packed placement has short paths that seldom collide in
the model, while the real router cannot go through a pad row and takes long
detours, and it is the detours that collide. The negotiated router also
deadlocked on nets that must reorder together (the real router escapes by
wrapping a trace around its own header first). One pass of the real router
sees the same corridors the full pass will, at a tenth of the cells.

Measured on 16 arrangements of the carrier board (8 hand-built, 8 random
packings) against a full routing pass as the truth:

| ranking | Kendall tau | first routable arrangement ranks |
|---|---|---|
| best hand-built score | 0.26 | 5th |
| stage 1 alone | 0.59 | 1st |
| stage 2 then stage 1 (what the search uses) | 0.70 | 1st, at completion 1.000 |

Re-run the measurement with:

```bash
npx tsx src/test_placement_proxy.ts     # ~3 minutes, a routing pass per arrangement
npx vitest run tests/pcbLayout.test.ts  # regression tests, incl. the two anchor arrangements
```

Two harness rules learned the hard way: score on the *placement* board, not
the cropped output (`layoutArrangement()` evaluates exactly as the search
does), and never compare candidates routed on different budgets.

### Auto-jumpers

With `autoJumpers` on, a connection the router genuinely cannot make gets a
soldered wire. A two-pad jumper footprint is placed and both halves are routed
to it; the wire itself is declared to the router as a linked pair rather than
cut in copper. The obvious move — jumpering the blocked net — is usually the
wrong one: if its pad is fenced in by other traces, a wire from outside the
fence still cannot reach it. So the search first tries lifting a segment of
whatever is **in the way** onto a wire, ranked by nearness to the failed run,
and only then the blocked net itself. Each candidate is routed with the same
budget the baseline had, judged on how many connections still fail (not on the
completion percentage, which moves because a jumper adds a connection), and up
to `maxAutoJumpers` (default 4) are added. Every jumper is reported as a
warning naming the link to solder after milling.

### Options that matter

| option | default | effect |
|---|---|---|
| `traceWidthMm`, `clearanceMm` | 0.4, 0.4 | keep-out radius; together they set the coarse grid pitch |
| `routingGridMm` | 0.25 | maze router resolution; cost is roughly quadratic in cells |
| `routingBudgetMs` | 8000 | wall-clock budget for one routing pass; the search scales its stages from it |
| `autoGrowBoard` | on | size the board from the parts, then crop to the copper; the requested size is a floor |
| `placementSearch` | on | search other arrangements when the schematic's own does not route |
| `placementCandidates` | 240 | random candidates after the structured ones, at most |
| `placementRouteTop` | 3 | candidates routed at full resolution |
| `autoJumpers`, `maxAutoJumpers` | off, 4 | soldered links for what copper cannot do |

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
