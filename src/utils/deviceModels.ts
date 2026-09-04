/**
 * Standard device models and parameters for BJTs, MOSFETs, and Op-Amps.
 */

export interface BjtModelDef {
  id: string;
  name: string;
  polarity: 'npn' | 'pnp';
  description: string;
  bf: number;
  is: number;
  vaf: number;
  rb: number;
  cjc: string;
  cje: string;
  ikf: number;
}

export interface MosfetModelDef {
  id: string;
  name: string;
  polarity: 'nmos' | 'pmos';
  description: string;
  vto: number;
  kp: number;
  lambda: number;
  rd: number;
  rs: number;
  cgs: string;
  cgd: string;
}

export interface OpAmpModelDef {
  id: string;
  name: string;
  description: string;
  gain: number;        // Open-loop DC gain (e.g. 100k, 200k)
  gbw: number;         // Gain-Bandwidth product in Hz (0 = ideal / infinite)
  rin: string;         // Differential input resistance (e.g. '100MEG', '2MEG', '1T')
  rout: number;        // Output resistance in Ohms (e.g. 0.01, 50, 75)
  vRailDropHi: number; // Headroom below positive rail VCC in Volts
  vRailDropLo: number; // Headroom above negative rail VEE in Volts
}

// ==========================================
// BJT Models
// ==========================================

export const BJT_NPN_MODELS: BjtModelDef[] = [
  {
    id: 'generic',
    name: 'Generic NPN',
    polarity: 'npn',
    description: 'Standard ideal small-signal model (β=300)',
    bf: 300,
    is: 1e-14,
    vaf: 100,
    rb: 10,
    cjc: '2p',
    cje: '4p',
    ikf: 0.4,
  },
  {
    id: '2n2222',
    name: '2N2222',
    polarity: 'npn',
    description: 'High-speed NPN switching transistor (800mA max)',
    bf: 200,
    is: 1.4e-14,
    vaf: 74,
    rb: 10,
    cjc: '8p',
    cje: '25p',
    ikf: 0.5,
  },
  {
    id: '2n3904',
    name: '2N3904',
    polarity: 'npn',
    description: 'Ubiquitous general-purpose small signal NPN (200mA max)',
    bf: 200,
    is: 1e-14,
    vaf: 74,
    rb: 20,
    cjc: '3.5p',
    cje: '4.5p',
    ikf: 0.1,
  },
  {
    id: 'bc547',
    name: 'BC547',
    polarity: 'npn',
    description: 'European standard low-noise / general-purpose NPN (100mA max)',
    bf: 300,
    is: 1.8e-14,
    vaf: 80,
    rb: 15,
    cjc: '4.5p',
    cje: '10p',
    ikf: 0.2,
  },
  {
    id: '2n3055',
    name: '2N3055',
    polarity: 'npn',
    description: 'Classic high-power NPN audio/power transistor (15A max)',
    bf: 50,
    is: 1e-11,
    vaf: 50,
    rb: 1,
    cjc: '150p',
    cje: '400p',
    ikf: 4.0,
  },
];

export const BJT_PNP_MODELS: BjtModelDef[] = [
  {
    id: 'generic',
    name: 'Generic PNP',
    polarity: 'pnp',
    description: 'Standard ideal small-signal model (β=300)',
    bf: 300,
    is: 1e-14,
    vaf: 100,
    rb: 10,
    cjc: '2p',
    cje: '4p',
    ikf: 0.4,
  },
  {
    id: '2n2907',
    name: '2N2907',
    polarity: 'pnp',
    description: 'High-speed PNP switching transistor, complement to 2N2222',
    bf: 200,
    is: 1.4e-14,
    vaf: 74,
    rb: 10,
    cjc: '8p',
    cje: '25p',
    ikf: 0.5,
  },
  {
    id: '2n3906',
    name: '2N3906',
    polarity: 'pnp',
    description: 'General-purpose small signal PNP, complement to 2N3904',
    bf: 200,
    is: 1e-14,
    vaf: 74,
    rb: 20,
    cjc: '4.5p',
    cje: '10p',
    ikf: 0.1,
  },
  {
    id: 'bc557',
    name: 'BC557',
    polarity: 'pnp',
    description: 'European standard low-noise PNP, complement to BC547',
    bf: 300,
    is: 1.8e-14,
    vaf: 80,
    rb: 15,
    cjc: '4.5p',
    cje: '10p',
    ikf: 0.2,
  },
  {
    id: 'mj2955',
    name: 'MJ2955',
    polarity: 'pnp',
    description: 'Classic high-power PNP transistor, complement to 2N3055',
    bf: 50,
    is: 1e-11,
    vaf: 50,
    rb: 1,
    cjc: '150p',
    cje: '400p',
    ikf: 4.0,
  },
];

// ==========================================
// MOSFET Models
// ==========================================

export const MOSFET_NMOS_MODELS: MosfetModelDef[] = [
  {
    id: 'generic',
    name: 'Generic NMOS',
    polarity: 'nmos',
    description: 'Standard ideal NMOS model (Vth=2.0V, Kp=0.05)',
    vto: 2.0,
    kp: 0.05,
    lambda: 0.01,
    rd: 0,
    rs: 0,
    cgs: '0',
    cgd: '0',
  },
  {
    id: '2n7000',
    name: '2N7000',
    polarity: 'nmos',
    description: 'Ubiquitous small-signal N-channel FET (Vth=2.1V, Rds(on)≈3Ω)',
    vto: 2.1,
    kp: 0.12,
    lambda: 0.02,
    rd: 1.2,
    rs: 1.2,
    cgs: '25p',
    cgd: '5p',
  },
  {
    id: 'bs170',
    name: 'BS170',
    polarity: 'nmos',
    description: 'Popular small-signal N-channel switch (500mA max)',
    vto: 2.0,
    kp: 0.15,
    lambda: 0.02,
    rd: 0.8,
    rs: 0.8,
    cgs: '24p',
    cgd: '7p',
  },
  {
    id: 'irf540n',
    name: 'IRF540N',
    polarity: 'nmos',
    description: 'High-current power NMOS (33A, 100V, Rds(on)≈44mΩ)',
    vto: 3.6,
    kp: 1.5,
    lambda: 0.005,
    rd: 0.022,
    rs: 0.022,
    cgs: '1.2n',
    cgd: '120p',
  },
];

export const MOSFET_PMOS_MODELS: MosfetModelDef[] = [
  {
    id: 'generic',
    name: 'Generic PMOS',
    polarity: 'pmos',
    description: 'Standard ideal PMOS model (Vth=-2.0V, Kp=0.02)',
    vto: -2.0,
    kp: 0.02,
    lambda: 0.01,
    rd: 0,
    rs: 0,
    cgs: '0',
    cgd: '0',
  },
  {
    id: 'bss84',
    name: 'BSS84',
    polarity: 'pmos',
    description: 'Small-signal P-channel switch (Vth=-1.7V, Rds(on)≈8Ω)',
    vto: -1.7,
    kp: 0.04,
    lambda: 0.02,
    rd: 4.0,
    rs: 4.0,
    cgs: '20p',
    cgd: '6p',
  },
  {
    id: 'irf9540',
    name: 'IRF9540',
    polarity: 'pmos',
    description: 'High-current power PMOS (-23A, -100V, Rds(on)≈0.1Ω)',
    vto: -3.5,
    kp: 0.8,
    lambda: 0.005,
    rd: 0.058,
    rs: 0.058,
    cgs: '1.1n',
    cgd: '150p',
  },
];

// ==========================================
// Op-Amp Models
// ==========================================

export const OPAMP_MODELS: OpAmpModelDef[] = [
  {
    id: 'ideal',
    name: 'Ideal / Rail-to-Rail',
    description: 'Ideal op-amp with infinite bandwidth and zero rail voltage drop',
    gain: 100000,
    gbw: 0,
    rin: '100MEG',
    rout: 0.01,
    vRailDropHi: 0,
    vRailDropLo: 0,
  },
  {
    id: 'lm741',
    name: 'LM741',
    description: 'Industry-standard general purpose bipolar op-amp (GBW=1MHz, ±2V rail drop)',
    gain: 200000,
    gbw: 1e6,
    rin: '2MEG',
    rout: 75,
    vRailDropHi: 2.0,
    vRailDropLo: 2.0,
  },
  {
    id: 'lm358',
    name: 'LM358 / LM324',
    description: 'Single-supply dual op-amp (ground-sensing, swings to Vee, 1.5V drop from Vcc)',
    gain: 100000,
    gbw: 1e6,
    rin: '10MEG',
    rout: 50,
    vRailDropHi: 1.5,
    vRailDropLo: 0.05,
  },
  {
    id: 'tl072',
    name: 'TL072 / TL082',
    description: 'Low-noise JFET-input dual op-amp (high input impedance, GBW=3MHz)',
    gain: 200000,
    gbw: 3e6,
    rin: '1T',
    rout: 50,
    vRailDropHi: 1.5,
    vRailDropLo: 1.5,
  },
  {
    id: 'mcp6002',
    name: 'MCP6002',
    description: 'Modern 1MHz low-power rail-to-rail I/O CMOS op-amp (1.8V-6V supply)',
    gain: 100000,
    gbw: 1e6,
    rin: '1T',
    rout: 20,
    vRailDropHi: 0.02,
    vRailDropLo: 0.02,
  },
];

export function getBjtModel(polarity: 'npn' | 'pnp', modelId?: string): BjtModelDef | undefined {
  const list = polarity === 'npn' ? BJT_NPN_MODELS : BJT_PNP_MODELS;
  return list.find(m => m.id.toLowerCase() === modelId?.toLowerCase());
}

export function getMosfetModel(polarity: 'nmos' | 'pmos', modelId?: string): MosfetModelDef | undefined {
  const list = polarity === 'nmos' ? MOSFET_NMOS_MODELS : MOSFET_PMOS_MODELS;
  return list.find(m => m.id.toLowerCase() === modelId?.toLowerCase());
}

export function getOpAmpModel(modelId?: string): OpAmpModelDef | undefined {
  return OPAMP_MODELS.find(m => m.id.toLowerCase() === modelId?.toLowerCase());
}

// ==========================================
// Resolving a node's effective parameters
// ==========================================

/*
 * `data.model` used to be a label and nothing more.
 *
 * The properties panel wrote the part number AND copied every parameter of that
 * part onto the node, and the netlist read only the parameters — so the two
 * agreed as long as the dropdown was the only thing that ever set a model. It
 * was not. A preset, a saved circuit, an imported one, or anything driving the
 * app through MCP could set `model: '2n3904'` and get a transistor labelled
 * 2N3904 that simulated as the generic β=300 device, with nothing anywhere
 * saying so.
 *
 * So the model is resolved here instead, and it now means what it says: the
 * catalogue supplies the parameters, and an explicit field on the node overrides
 * the one it came with. Selecting a part in the UI still writes the parameters
 * out — that is what makes them editable, and an edit is what 'custom' records —
 * but nothing depends on it having done so.
 */

const GENERIC_BJT = { bf: 300, is: 1e-14, vaf: 100, ikf: 0.4, rb: 10, cjc: '2p', cje: '4p' } as const;

export interface ResolvedBjtParams {
  bf: number; is: number; vaf: number; ikf: number; rb: number; cjc: string; cje: string;
}

/** Node data as the netlist sees it: anything may be absent, and often is. */
type DeviceData = Record<string, unknown> | undefined | null;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** cjc/cje/cgs/cgd carry SPICE suffixes ('2p'), so they stay strings. */
const str = (v: unknown): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : String(v);

export function resolveBjtParams(polarity: 'npn' | 'pnp', data: DeviceData): ResolvedBjtParams {
  const d = data ?? {};
  const m = getBjtModel(polarity, typeof d.model === 'string' ? d.model : undefined);
  return {
    bf:  num(d.bf)  ?? m?.bf  ?? GENERIC_BJT.bf,
    is:  num(d.is)  ?? m?.is  ?? GENERIC_BJT.is,
    vaf: num(d.vaf) ?? m?.vaf ?? GENERIC_BJT.vaf,
    ikf: num(d.ikf) ?? m?.ikf ?? GENERIC_BJT.ikf,
    rb:  num(d.rb)  ?? m?.rb  ?? GENERIC_BJT.rb,
    cjc: str(d.cjc) ?? m?.cjc ?? GENERIC_BJT.cjc,
    cje: str(d.cje) ?? m?.cje ?? GENERIC_BJT.cje,
  };
}

export interface ResolvedMosfetParams {
  vto: number; kp: number; lambda: number; rd: number; rs: number; cgs: string; cgd: string;
}

export function resolveMosfetParams(polarity: 'nmos' | 'pmos', data: DeviceData): ResolvedMosfetParams {
  const d = data ?? {};
  const m = getMosfetModel(polarity, typeof d.model === 'string' ? d.model : undefined);
  const isN = polarity === 'nmos';
  return {
    vto:    num(d.vto)    ?? m?.vto    ?? (isN ? 2.0 : -2.0),
    kp:     num(d.kp)     ?? m?.kp     ?? (isN ? 0.05 : 0.02),
    lambda: num(d.lambda) ?? m?.lambda ?? 0.01,
    rd:     num(d.rd)     ?? m?.rd     ?? 0,
    rs:     num(d.rs)     ?? m?.rs     ?? 0,
    cgs:    str(d.cgs)    ?? m?.cgs    ?? '0',
    cgd:    str(d.cgd)    ?? m?.cgd    ?? '0',
  };
}

export interface ResolvedOpAmpParams {
  gain: number; gbw: number; rin: string; rout: number; vRailDropHi: number; vRailDropLo: number;
}

export function resolveOpAmpParams(data: DeviceData): ResolvedOpAmpParams {
  const d = data ?? {};
  const m = getOpAmpModel(typeof d.model === 'string' ? d.model : undefined);
  return {
    gain:        num(d.gain)        ?? m?.gain        ?? 100000,
    gbw:         num(d.gbw)         ?? m?.gbw         ?? 0,
    rin:         str(d.rin)         ?? m?.rin         ?? '100MEG',
    rout:        num(d.rout)        ?? m?.rout        ?? 0.01,
    vRailDropHi: num(d.vRailDropHi) ?? m?.vRailDropHi ?? 0,
    vRailDropLo: num(d.vRailDropLo) ?? m?.vRailDropLo ?? 0,
  };
}
