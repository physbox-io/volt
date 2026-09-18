import { createContext, useContext } from 'react';

/**
 * What the canvas is doing, for the parts and wires that draw themselves from it.
 *
 * Both of these used to be copied into node `data` from an effect in `App`:
 * `isSimulating` onto every node on each start and stop, `simLength` onto the
 * microphones whenever the length changed. That is a whole-canvas re-render and
 * a fresh `data` object per node to carry one boolean, and it put a field into
 * `data` that looks exactly like something a person set — which is why the
 * netlist signature has to list the fields it trusts rather than hash `data`.
 *
 * A symbol that needs the run's state reads it from here instead.
 */
export interface CanvasState {
  /** True from the moment a run starts until it is stopped or reset. */
  isSimulating: boolean;
  /** The run's length, in seconds. */
  simLength: number;
  /**
   * Draw the glow along a wire carrying current. A display setting, which used
   * to be carried by rewriting every edge's `type` — so a toggle nobody thinks
   * of as an edit wrote the whole graph, and an edge that arrived from a preset
   * with no type of its own only got a usable one once that effect had run.
   */
  showAura: boolean;
}

const CanvasStateContext = createContext<CanvasState>({
  isSimulating: false,
  simLength: 1,
  showAura: false,
});

export const CanvasStateProvider = CanvasStateContext.Provider;

export function useCanvasState(): CanvasState {
  return useContext(CanvasStateContext);
}
