import type { ResultType } from 'eecircuit-engine';

/**
 * What a transient or operating-point run hands back.
 *
 * The engine's `ResultType` is a union over real and complex data. Everything
 * solved in the time domain — which is every `.tran` the app emits, and the
 * single-point `.op` behind the DC overlay — is real, and narrowing it here is
 * what lets the readers index `values` as numbers instead of carrying a complex
 * branch none of them would know what to do with.
 */
export type SpiceResult = Extract<ResultType, { dataType: 'real' }>;

/**
 * What a frequency sweep hands back.
 *
 * `.ac` is small-signal, so every value is a phasor and `values` is a list of
 * `{ real, img }`. It is a separate type rather than a widening of `SpiceResult`
 * precisely so that no existing reader can be handed one by accident.
 */
export type SpiceComplexResult = Extract<ResultType, { dataType: 'complex' }>;

export type AnySpiceResult = SpiceResult | SpiceComplexResult;
