/**
 * The `data` object each kind of part on the schematic canvas carries.
 *
 * React Flow types a node's `data` as `Record<string, unknown>`, so typing a
 * symbol's props without also writing down its data shape only moves the
 * problem: every `data.frequency` becomes an `unknown` that has to be cast at
 * the point of use. That is why all thirty-odd symbols were declared
 * `function XNode({ data, selected }: any)` — one `any` at the top of the file
 * bought an untyped read of every field below it, and a field renamed in the
 * properties panel but not in the symbol rendered as `undefined` in silence.
 *
 * Each shape is written down once here and each symbol takes
 * `NodeProps<Node<XNodeData>>`. Three different kinds of field live in these
 * types, and knowing which is which explains why so many of them are optional:
 *
 *  - **What the operator sets** — `label`, `orientation`, `model`, a value.
 *    Absent until it is touched, which is why the symbols all carry defaults.
 *  - **What the netlist generator reads** — `src/utils/spice.ts` turns these
 *    into SPICE cards. A numeric field (`resistance`) wins over the written
 *    label ("4k7") when both are present.
 *  - **What a simulation run writes back** — `voltage_array`, `time_points`,
 *    `isSimulating` and friends are pushed into node `data` by `App.tsx` once
 *    a run finishes, so an instrument can animate from its own `data` without
 *    re-rendering the canvas on every frame.
 *
 * Everything is optional because a node can arrive from a preset, from a saved
 * file written by an older build, or from an MCP agent, and none of those are
 * obliged to fill a field in.
 */

/**
 * How a two-lead part sits on the canvas. `vertical` and `up` stand it on end;
 * `left` and `up` additionally mirror it. See `resolveOrientation` in
 * `components/nodes/schematic.tsx`, which is the only place this is decoded.
 */
export type Orientation = 'horizontal' | 'vertical' | 'left' | 'up';

/** One point of a piecewise-linear waveform: `t` in seconds, `v` in volts. */
export type PwlPoint = { t: number; v: number };

/** Fields any part may carry, whatever it is. */
export type BaseNodeData = {
  /** The value as written — "4.7k", "5V", "1N4148". Parsed by `engValue`. */
  label?: string;
  /** Reference designator override; absent means `getNodeDefaultName()`. */
  name?: string;
  orientation?: Orientation;
};

/* ── Passives ─────────────────────────────────────────────────────────── */

export type ResistorNodeData = BaseNodeData & {
  /** Ohms. Set by MCP or an import; otherwise the label is parsed. */
  resistance?: number;
};

export type CapacitorNodeData = BaseNodeData & {
  /** Farads; see `resistance` above for why both exist. */
  capacitance?: number;
};

export type InductorNodeData = BaseNodeData & {
  /** Henries; see `resistance` above for why both exist. */
  inductance?: number;
};

export type PotentiometerNodeData = BaseNodeData & {
  /** Wiper position, 0–100%. */
  position?: number;
};

export type TransformerNodeData = BaseNodeData & {
  /** Primary/secondary inductance as written, e.g. "10mH". */
  l_pri_label?: string;
  l_sec_label?: string;
  /** The same two as SPICE values, e.g. "10m". */
  l_pri?: string | number;
  l_sec?: string | number;
  /** Coupling coefficient, 0–1. */
  k?: number;
};

/* ── Sources ──────────────────────────────────────────────────────────── */

export type VoltageNodeData = BaseNodeData & {
  /** Volts. */
  voltage?: number;
};

export type ACVoltageNodeData = BaseNodeData & {
  /** Peak amplitude in volts. */
  amplitude?: number;
  /** Hertz. */
  frequency?: number;
};

export type CurrentSourceNodeData = BaseNodeData & {
  /** Amps. */
  value?: number;
};

export type Waveform = 'sine' | 'square' | 'triangle' | 'sawtooth';

export type SignalGeneratorNodeData = BaseNodeData & {
  waveform?: Waveform;
  frequency?: number;
  amplitude?: number;
  /** Square-wave duty, 0–100%. */
  dutyCycle?: number;
};

/* ── Semiconductors ───────────────────────────────────────────────────── */

export type DiodeNodeData = BaseNodeData & {
  /** Forward drop in volts. */
  v_drop?: number;
};

export type ZenerDiodeNodeData = BaseNodeData & {
  /** Reverse breakdown in volts. */
  v_breakdown?: number;
};

/**
 * A part picked from a catalogue.
 *
 * `model` names the catalogue entry. The device parameters beside it are the
 * per-part overrides the properties panel writes when one is edited by hand,
 * which is also what sets `model` to 'custom' — a node normally carries none
 * of them, and `resolveBjtParams` and friends fill them in from the part.
 * Keep this list in step with `DEVICE_PARAM_KEYS` in `PropertiesPanel.tsx`,
 * which is what clears them when a catalogue part is chosen.
 */
export type ModelledDeviceNodeData = BaseNodeData & {
  model?: string;
};

/** The parameters that carry SPICE suffixes ('2p') and so stay strings. */
export type BjtNodeData = ModelledDeviceNodeData & {
  bf?: number;
  is?: number;
  vaf?: number;
  ikf?: number;
  rb?: number;
  cjc?: string;
  cje?: string;
};

export type MosfetNodeData = ModelledDeviceNodeData & {
  vto?: number;
  kp?: number;
  lambda?: number;
  rd?: number;
  rs?: number;
  cgs?: string;
  cgd?: string;
};

export type OpAmpNodeData = ModelledDeviceNodeData & {
  gain?: number;
  gbw?: number;
  rin?: number;
  rout?: number;
  vRailDropHi?: number;
  vRailDropLo?: number;
};

export type LedNodeData = BaseNodeData & {
  /** CSS colour name for the lens, e.g. 'red'. */
  color?: string;
  v_drop?: number;
  /** Milliamps; the current above which the symbol draws itself blown. */
  max_current?: number;
  /** Run the part backwards, as a light sensor rather than a lamp. */
  photodiodeMode?: boolean;
  /** Photodiode sensitivity in microamps per unit of light. */
  lightSensitivity?: number;
  /** Incident light, 0–1, when not being driven from a stream. */
  lightLevel?: number;
  isWebcamActive?: boolean;
  /** Light as a recorded stream, taking precedence over `lightLevel`. */
  pwlData?: PwlPoint[];
  isExploded?: boolean;
  /** Written by the run: see the module comment. */
  isSimulating?: boolean;
  current_array?: number[];
  time_points?: number[];
  /** Steady-state brightness, 0–1, for a part that is not being animated. */
  brightness?: number;
};

export type LdrNodeData = BaseNodeData & {
  /** Dark resistance in ohms. */
  r_dark?: number | string;
  /** The same as written, e.g. "100k". */
  r_dark_label?: string;
  lightLevel?: number;
  isWebcamActive?: boolean;
  pwlData?: PwlPoint[];
};

/* ── Discrete logic ───────────────────────────────────────────────────── */

export type SevenSegmentNodeData = BaseNodeData & {
  common?: 'anode' | 'cathode';
  isSimulating?: boolean;
  /** Steady-state volts per segment, keyed 'a'…'g'. */
  segmentVoltages?: Record<string, number>;
  /** The same, sampled over the run, for playback. */
  segmentVoltageArrays?: Record<string, number[]>;
  timePoints?: number[];
};

/* ── Switches ─────────────────────────────────────────────────────────── */

export type SwitchNodeData = BaseNodeData & {
  /** Absent counts as open — the switch ships open. */
  isOpen?: boolean;
};

/* ── Instruments ──────────────────────────────────────────────────────── */

export type ScopeNodeData = BaseNodeData & {
  /** Channel 1, with `voltageData` the name older files wrote it under. */
  voltageData?: PwlPoint[];
  voltageData1?: PwlPoint[];
  voltageData2?: PwlPoint[];
  showFFT?: boolean;
  /** Absent counts as on. */
  showPeriod?: boolean;
  /** Volts and seconds per division; absent means auto-range. */
  vDiv?: number;
  tDiv?: number;
  /** Screen size in px, as left by the resize handle. */
  width?: number;
  height?: number;
  /** Injected by `App.tsx` so the handle can write the size back. */
  onResize?: (width: number, height: number) => void;
};

export type MultimeterNodeData = BaseNodeData & {
  mode?: 'voltage' | 'current';
  /** Read RMS rather than the instantaneous value. */
  isRms?: boolean;
  /** Written by the run: the steady-state reading and the sampled trace. */
  voltage?: number;
  voltage_array?: number[];
  time_points?: number[];
  isSimulating?: boolean;
};

/* ── Audio ────────────────────────────────────────────────────────────── */

export type MicrophoneNodeData = BaseNodeData & {
  /** Gain applied to the recorded signal. */
  amplification?: number;
  pwlData?: PwlPoint[];
  /** The run's length in seconds, so a recording can be cut to fit it. */
  simLength?: number;
};

export type SpeakerNodeData = BaseNodeData & {
  /** Where the audio goes: this computer, or the CYD's own buzzer. */
  outputTarget?: 'computer' | 'cyd';
  /** Volts that map to full scale. */
  voltageScale?: number;
  /** Remove the DC offset before playing. */
  acCouple?: boolean;
  /** Scale the loudest peak to full scale. */
  normalize?: boolean;
  /** Written by the run. `t` is in milliseconds here, not seconds. */
  voltageData?: PwlPoint[];
};

/* ── Programmable parts ───────────────────────────────────────────────── */

export type McuNodeData = BaseNodeData & {
  /** The sketch, as typed into the code editor. */
  code?: string;
  /** `console.log` output from the last run. */
  logs?: string[];
  /** Carried between slices so a sketch keeps its variables across a run. */
  state?: Record<string, unknown>;
  /** Package, pin list and footprint; see `utils/mcuConfig.ts`. */
  mcuConfig?: unknown;
};

/** Pin direction as configured on the board, keyed by pin id. */
export type HilPinModes = Record<string, string>;

export type HeltecV4NodeData = BaseNodeData & {
  /** The board's address on the network. */
  ip?: string;
  isConnected?: boolean;
  /** Run the sketch on the real board rather than in SPICE. */
  hilEnabled?: boolean;
  /** The last transport failure, shown on the symbol. */
  hilError?: string;
  /** 'native' batches a slice into one UART transaction; 'legacy' does not. */
  hilExecutionMode?: 'native' | 'legacy';
  hilMemoizationEnabled?: boolean;
  /** Decimal places the memoizer rounds inputs / initial conditions to. */
  hilInputDP?: number;
  hilIcDP?: number;
  hilMaxConsecutiveHits?: number;
  hilStats?: import('../utils/hilMemoizer').HILMemoizerStats | null;
  pins?: HilPinModes;
  /** Volts measured on, or driven onto, each pin. */
  pinVoltages?: Record<string, number>;
};

/* ── Board-only parts ─────────────────────────────────────────────────── */
/* These never reach the SPICE netlist; they exist so the PCB has holes. */

export type PinHeaderNodeData = BaseNodeData & {
  rows?: number;
  cols?: number;
  /** Hole-to-hole spacing along a row, in mm. */
  pitchMm?: number;
  /** Row-to-row spacing, in mm. */
  rowSpacingMm?: number;
};

export type ViaNodeData = BaseNodeData & {
  drillDiameterMm?: number;
  padDiameterMm?: number;
};

export type MountingHoleNodeData = BaseNodeData & {
  /** 'M2' … 'M5', or 'custom' when the diameters are set by hand. */
  screwSize?: string;
  holeDiameterMm?: number;
  /** Diameter of the copper keepout around the hole, in mm. */
  keepoutDiameterMm?: number;
};

export type JumperNodeData = BaseNodeData & {
  pitchMm?: number;
  drillDiameterMm?: number;
};

export type CutoutNodeData = BaseNodeData & {
  cutoutShape?: 'rect' | 'circle';
  cutoutWidthMm?: number;
  /** Ignored for a circle, which is `cutoutWidthMm` across. */
  cutoutHeightMm?: number;
};

/**
 * Every field any part can carry, all optional.
 *
 * The properties panel and the node registry are dispatched by `node.type` at
 * run time — `nodeRegistry` is a `Record<string, NodeMeta>`, so there is no
 * point at which the compiler knows which kind of node the panel was handed.
 * This is what that genuinely is: the union of the shapes, flattened. Symbols
 * themselves are typed precisely, because each one only ever renders its own
 * kind.
 */
export type AnyNodeData = ResistorNodeData &
  CapacitorNodeData &
  InductorNodeData &
  PotentiometerNodeData &
  TransformerNodeData &
  VoltageNodeData &
  ACVoltageNodeData &
  CurrentSourceNodeData &
  SignalGeneratorNodeData &
  DiodeNodeData &
  ZenerDiodeNodeData &
  BjtNodeData &
  MosfetNodeData &
  OpAmpNodeData &
  LedNodeData &
  LdrNodeData &
  SevenSegmentNodeData &
  SwitchNodeData &
  ScopeNodeData &
  MultimeterNodeData &
  MicrophoneNodeData &
  SpeakerNodeData &
  McuNodeData &
  HeltecV4NodeData &
  PinHeaderNodeData &
  ViaNodeData &
  MountingHoleNodeData &
  JumperNodeData &
  CutoutNodeData;

/**
 * A node's `data` as React Flow hands it over, before its kind is known.
 *
 * The board-only parts export geometry helpers that are called from two sides:
 * from the symbol, which knows its own shape, and from edge routing and the
 * PCB exporter, which walk every node on the canvas and have only
 * `Node['data']`. Those helpers take this and coerce, which is also the right
 * reading for data that arrived from a saved file or an MCP agent.
 */
export type RawNodeData = Record<string, unknown>;
