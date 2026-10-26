/*
 * What a run writes onto the parts: node voltages, scope traces, MCU logs,
 * motor speeds, fuse and latch state. None of it is the circuit as drawn.
 *
 * Reset strips exactly these, and the undo history ignores them (plus the
 * glow a stopped run leaves on an LED) when it decides whether anything has
 * changed — or else every run was an edit: an undo step for nothing, and a
 * tab that asked before closing over a circuit nobody had touched.
 */
export const RUN_READINGS = [
  'voltage', 'voltageData', 'voltageData1', 'voltageData2',
  'current_array', 'time_points', 'timePoints',
  'segmentVoltages', 'segmentVoltageArrays',
  'pinVoltages', 'state', 'logs', 'isSimulating',
  'rpm', 'angleDeg', 'blown', 'signalValue', 'latchedHigh',
] as const;

/** Reset's list, plus what a stop paints on an LED, which Reset leaves. */
const NOT_EDITS = [...RUN_READINGS, 'brightness', 'isExploded', 'selected'];

/** A node's data without its run readings. */
export function withoutRunReadings(data: Record<string, unknown>): Record<string, unknown> {
  const kept = { ...data };
  for (const key of RUN_READINGS) delete kept[key];
  return kept;
}

/** A node's data as the undo history compares it: only what someone drew or set. */
export function editableData(data: Record<string, unknown>): Record<string, unknown> {
  const kept = { ...data };
  for (const key of NOT_EDITS) delete kept[key];
  return kept;
}
