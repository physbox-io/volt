import type { Node } from '@xyflow/react';
import type { McuDrive } from '../mcu';
import type { SimState } from '../simState';
import type { LogicTrace } from './knownLogic';

/** What a part is handed to write its cards with. */
export type EmitContext = {
  /** The net one of this part's pins is on, by handle id. */
  net: (handle: string) => string;
  /** ` AC 1` when this part is the source an AC sweep is driven from, else ''. */
  acDrive: string;
  /** The state the run starts from, for a coil's ` IC=`. */
  initialConditions?: SimState;
  /** What this part's sketch drives onto its pins, for an MCU. */
  mcuDrive?: McuDrive;
  /**
   * The simulated time the run starts at, seconds: 0 for a run from rest,
   * where a carried state left off otherwise. A source that is a function of
   * time emits from here, so a sliced run is one continuous waveform.
   */
  time: number;
  /** How long the run is, seconds. */
  length: number;
  /**
   * A pin's logic level over the run when it is decided before solving (see
   * `knownLogic`), else null. Asks for the pin's net as `net` does.
   */
  logic: (handle: string) => LogicTrace | null;
  /**
   * Whether this run must keep up with real time (a slice of HIL or of a
   * Mesh-linked run), so a part with a lighter model should use it.
   */
  realtime: boolean;
};

/**
 * How one kind of part reaches the netlist. A part type with no entry in
 * `partEmitters` contributes no device.
 */
export type PartEmitter = {
  /** This part's device cards, each ending in a newline. */
  emit: (node: Node, ctx: EmitContext) => string;
  /**
   * Definitions written once, after every part's cards, when the circuit has
   * at least one part of this type: a subcircuit its cards instance. Handed
   * every such part, in canvas order.
   */
  library?: (parts: Node[]) => string;
  /** Whether this part needs audio-rate time steps to be heard. */
  audio?: (node: Node) => boolean;
  /**
   * Whether what this part emits depends on `time`, so two runs from the same
   * circuit state at different times are different runs.
   */
  timeVarying?: (node: Node) => boolean;
};
