/**
 * Smooth logic for behavioral parts: a logistic step 50mV wide around the
 * threshold rather than a hard comparison, so the solver sees a continuous
 * function and does not shrink its step to nothing hunting an edge.
 */
export const LOGIC_THRESHOLD_V = 1.5;

/** 0 below the threshold, 1 above it, for `V(pin) − V(ref)`. */
export const logicHigh = (pin: string, ref: string, threshold = LOGIC_THRESHOLD_V) =>
  `(1 / (1 + exp(-(V(${pin}, ${ref}) - ${threshold}) / 0.05)))`;
