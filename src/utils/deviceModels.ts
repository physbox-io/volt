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
