import type { ResultType } from 'eecircuit-engine';

/**
 * What a SPICE run hands back.
 *
 * The engine's `ResultType` is a union over real and complex data, but every
 * netlist this app emits ends in `.tran` — there is no AC or noise analysis
 * anywhere in `spice.ts` — so the data is always real. Narrowing it here is
 * what lets the readers index `values` as numbers instead of carrying a
 * complex branch none of them would know what to do with.
 */
export type SpiceResult = Extract<ResultType, { dataType: 'real' }>;
