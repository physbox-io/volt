/**
 * Every command useMCPBridge's switch answers, by name, so LIST_COMMANDS can
 * report them (the machine commands are added from their handler table).
 * tests/mcpCommandList.test.ts reads the switch's case labels from the source
 * and fails if this list and the switch ever disagree.
 */
export const SWITCH_COMMANDS: readonly string[] = [
  'GET_STATE',
  'GET_COMPONENTS',
  'GET_EDGES',
  'RUN_SIM',
  'RUN_OP',
  'GET_OPERATING_POINT',
  'RUN_AC_SWEEP',
  'GET_BODE',
  'RUN_PARAMETER_SWEEP',
  'PARAMETER_SWEEP',
  'STOP_SIM',
  'RESET',
  'GET_WAVEFORMS',
  'GET_HISTORY',
  'TOGGLE_PROBE',
  'SET_NODES',
  'UPDATE_COMPONENT',
  'LIST_MCU_PRESETS',
  'DEFINE_MCU',
  'DELETE_COMPONENT',
  'SET_EDGES',
  'UPLOAD_AUDIO',
  'GET_SPEAKER_AUDIO',
  'VALIDATE_CIRCUIT',
  'LIST_PRESETS',
  'SAVE_PRESET',
  'DELETE_PRESET',
  'GET_SUMMARY',
  'SET_CIRCUIT',
  'GET_NOTE_CARDS',
  'SET_NOTE_CARDS',
  'SCREENSHOT',
  'GET_PCB_LAYOUT',
  'GET_PCB_PREVIEW',
  'LOAD_PRESET',
  'LIST_COMMANDS',
];
