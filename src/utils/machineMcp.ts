import {
  ArmingGate,
  createMachineHandlers,
  describeMachine,
  gridOffPlaneMm,
  requireNumber,
  type ArmingState,
} from '@physbox-io/machining';
import type { Edge, Node } from '@xyflow/react';
import { webSerialManager, type ProbeGrid } from './webSerialManager';
import { generatePcbLayout, type PcbOptions } from './pcbExporter';
import { loadMachiningSettings } from './storage';
import { fetchMachineDevices } from './apiClient';

// ---------------------------------------------------------------------------
// Driving Volt's machine from MCP
// ---------------------------------------------------------------------------
//
// The command set and the arming gate are shared with Etch and Mesh. What is
// here is the part that is Volt's: milling the board that is on the canvas, and
// the checks that stand between an agent asking for that and a cutter moving.
//
// Those checks are the same ones the export dialog makes before its own Mill
// button will do anything. They are repeated here rather than shared with the
// dialog because the dialog can refuse by greying a button out and explaining
// itself on screen; an agent needs to be told, in a sentence it can act on.

/**
 * The gate. One per tab, because there is one machine.
 *
 * Disarming cancels whatever the agent had running. A window closed while a job
 * is streaming has to stop the job — otherwise "stop letting Claude move this"
 * would be a button that changes nothing until the next command, which is the
 * opposite of what someone reaching for it wants.
 */
export const machineArming = new ArmingGate({
  onDisarm: () => {
    if (webSerialManager.isRunning() || webSerialManager.isJobPaused()) {
      void webSerialManager.cancelJob();
    }
  },
});

/** What the UI banner watches. */
export function subscribeToArming(listener: (state: ArmingState) => void): () => void {
  return machineArming.subscribe(listener);
}

/**
 * The canvas, as the bridge last saw it.
 *
 * The MCP handlers are built once and live as long as the tab, while the nodes
 * and edges are React state that changes under them. Rather than rebuild the
 * handlers on every render, the bridge keeps this pointed at the current
 * circuit — the same circuit the rest of the bridge's commands read.
 */
let currentCircuit: { nodes: Node[]; edges: Edge[] } = { nodes: [], edges: [] };

export function setCurrentCircuit(nodes: Node[], edges: Edge[]): void {
  currentCircuit = { nodes, edges };
}

/** The height map the export dialog last probed, if it is still on screen. */
let activeHeightmap: ProbeGrid | null = null;

export function setActiveHeightmap(grid: ProbeGrid | null): void {
  activeHeightmap = grid;
}

function boardBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const { nodes, edges } = currentCircuit;
  if (nodes.length === 0) return null;
  const result = generatePcbLayout(nodes, edges, loadMachiningSettings());
  if (result.error) return null;
  return {
    minX: 0,
    minY: 0,
    maxX: result.boardWidthMm,
    maxY: result.boardHeightMm,
  };
}

/**
 * Mills the board currently on the canvas.
 *
 * Every refusal below is a board that came out wrong, and each says what to do
 * rather than only what is missing — an agent that is told "completion is 0.82"
 * will helpfully mill 82% of a board, which is scrap.
 */
async function millCurrentBoard(args: Record<string, unknown>): Promise<{ summary: string }> {
  const { nodes, edges } = currentCircuit;
  if (nodes.length === 0) {
    throw new Error('The canvas is empty — there is no board to mill.');
  }

  const overrides = (args.options ?? {}) as Partial<PcbOptions>;
  const result = generatePcbLayout(nodes, edges, { ...loadMachiningSettings(), ...overrides });
  if (result.error) throw new Error(result.error);

  // A board with a net that would not route is not a board. Milling it produces
  // one that is missing exactly the connections that were hardest to make, and
  // the failure is invisible until it is assembled and does not work.
  if (result.completion < 1) {
    throw new Error(
      `${result.unrouted.length} connection(s) could not be routed, so this board is not finished: ` +
        `${result.unrouted.map(u => `${u.netId} (${u.from} to ${u.to}): ${u.reason}`).join('; ')}. ` +
        'The board has one copper layer, so a net that has to cross another cannot be routed at ' +
        'all — place a `jumper` to fly it over, or move the part. Call circuit_get_pcb_layout for ' +
        'the detail. Milling it now would produce a board missing those connections.'
    );
  }

  if (result.violations.length > 0) {
    throw new Error(
      `The board has ${result.violations.length} design rule violation(s): ` +
        `${result.violations.slice(0, 5).join('; ')}. Fix them before cutting.`
    );
  }

  const state = webSerialManager.getState();
  if (!state.connected) {
    throw new Error('No machine is connected. Connect one first.');
  }

  // The same refusal the Mill button makes. The isolation depth is shaved down
  // on the strength of a probed map, and the levelling is what buys back the
  // margin — so a job whose depth assumed a map that will not be applied cuts
  // traces too faint to isolate and misses the copper on the high spots.
  const heightmap = activeHeightmap;
  if (heightmap) {
    const offPlane = gridOffPlaneMm(heightmap);
    if (offPlane > 0.05) {
      throw new Error(
        `The loaded height map sits ${offPlane.toFixed(3)}mm off the work Z0 plane, so it no ` +
          'longer describes this setup. Re-probe the surface before milling.'
      );
    }
  }

  const gcode = webSerialManager.applyHeightmapToGcode(result.gcode, heightmap);
  // startJob makes the remaining checks itself — the machine must not be in
  // alarm, and work Z0 must have been confirmed this session rather than left
  // over in the controller's EEPROM from another board.
  await webSerialManager.startJob(gcode);

  const levelled = heightmap ? 'levelled against the probed height map' : 'not levelled';
  return {
    summary:
      `Milling a ${result.boardWidthMm.toFixed(1)} x ${result.boardHeightMm.toFixed(1)}mm board: ` +
      `${result.components.length} components, ${result.traces.length} traces, ` +
      `${result.drills.length} drills, ${levelled}. ` +
      `Estimated ${Math.round(result.cycleTimeSec / 60)} minutes.`,
  };
}

/**
 * Probes the board surface and keeps the map for the next mill.
 *
 * Volt's own, rather than one of the shared verbs: the grid it produces is
 * checked against a set of rules that only mean anything for a copper-clad
 * board, and those live in the manager.
 */
async function probeBoardSurface(args: Record<string, unknown>): Promise<unknown> {
  const bounds = boardBounds();
  if (!bounds) throw new Error('There is no board on the canvas to probe.');

  const grid = await webSerialManager.probeSurfaceMesh({
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    cols: typeof args.cols === 'number' ? args.cols : undefined,
    rows: typeof args.rows === 'number' ? args.rows : undefined,
  });
  setActiveHeightmap(grid);

  const zs = grid.points.flat().map(p => p.z);
  return {
    ok: true,
    cols: grid.gridX,
    rows: grid.gridY,
    spanMm: Math.max(...zs) - Math.min(...zs),
    // The number the depth budget is actually spent against.
    repeatabilityMm: grid.verifyDeviationMm,
  };
}

/**
 * Volt's full machine command set, keyed by the bridge command names.
 *
 * Built once. The shared handlers read the machine live, and the two things
 * that do change — the circuit and the height map — are pointed at from above.
 */
export function createVoltMachineHandlers(): Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> {
  const shared = createMachineHandlers({
    machine: webSerialManager,
    gate: machineArming,
    options: {
      runJob: millCurrentBoard,
      jobBounds: boardBounds,
      listDevices: async () => {
        const devices = await fetchMachineDevices();
        return devices.map(d => ({ id: d.deviceId, name: d.name, online: d.online }));
      },
    },
  });

  return {
    MACHINE_STATUS: shared.status,
    MACHINE_SETTINGS: shared.settings,
    MACHINE_LIST_DEVICES: shared.devices,
    MACHINE_ARM: shared.arm,
    MACHINE_DISARM: shared.disarm,
    MACHINE_CONNECT: shared.connect,
    MACHINE_DISCONNECT: shared.disconnect,
    MACHINE_JOG: shared.jog,
    MACHINE_HOME: shared.home,
    MACHINE_UNLOCK: shared.unlock,
    MACHINE_GOTO_ORIGIN: shared.goto_origin,
    MACHINE_ZERO_XY: shared.zero_xy,
    MACHINE_FRAME_JOB: shared.frame_job,
    MACHINE_TRIM: shared.trim,
    MACHINE_PAUSE: shared.pause,
    MACHINE_RESUME: shared.resume,
    MACHINE_CANCEL: shared.cancel,
    MACHINE_ESTOP: shared.estop,
    MILL_PCB: shared.run_job,

    /**
     * Sets work Z0 on the copper with the continuity clip, or on a touch plate.
     *
     * Volt's own rather than a shared verb, because the two surfaces mean
     * different things: a plate stops the tool one plate-thickness above the
     * copper, and passing the wrong thickness — or none — puts every cut in the
     * job out by that difference.
     */
    MACHINE_ZERO_Z: async (args: Record<string, unknown>) => {
      machineArming.requireArmed('zero_z');
      machineArming.noteAgentCommand('zero_z', args.touchPlateMm ? `plate=${args.touchPlateMm}` : 'on surface');
      // Checked rather than cast. `as number` is a compiler instruction and
      // nothing at run time: a `surfaceOffsetMm` of "0.1" would have been
      // coerced by the arithmetic downstream and put every cut in the job out
      // by a tenth, and one of "abc" would have reached the controller as
      // `ZNaN`. Refusing costs nothing here — the machine has not moved.
      const surfaceOffsetMm = requireNumber(args, 'surfaceOffsetMm', { default: 0 })!;
      const touchPlateMm = requireNumber(args, 'touchPlateMm');
      if (touchPlateMm !== undefined) {
        await webSerialManager.zeroZ(touchPlateMm, surfaceOffsetMm);
      } else {
        await webSerialManager.zeroZOnSurface(surfaceOffsetMm);
      }
      await webSerialManager.refreshPosition();
      return {
        ...describeMachine(webSerialManager, machineArming),
        // How far the two stabs of the probe disagreed: the machine's own
        // repeatability at the one place everything else is referenced to.
        zeroScatterMm: webSerialManager.getState().zeroZScatterMm,
      };
    },

    MACHINE_PROBE_SURFACE: async (args: Record<string, unknown>) => {
      machineArming.requireArmed('probe_surface');
      machineArming.noteAgentCommand('probe_surface');
      return probeBoardSurface(args);
    },
  };
}
