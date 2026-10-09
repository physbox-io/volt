import type { Node } from '@xyflow/react';
import type { McuDrive } from '../mcu';
import type { SimState } from '../simState';

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
};
