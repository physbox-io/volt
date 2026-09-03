import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { generateSpiceNetlist } from '../src/utils/spice';
import {
  BJT_NPN_MODELS,
  BJT_PNP_MODELS,
  MOSFET_NMOS_MODELS,
  MOSFET_PMOS_MODELS,
  OPAMP_MODELS,
  getBjtModel,
  getMosfetModel,
  getOpAmpModel,
} from '../src/utils/deviceModels';

describe('deviceModels catalog', () => {
  it('contains standard BJT NPN models', () => {
    const ids = BJT_NPN_MODELS.map(m => m.id);
    expect(ids).toContain('generic');
    expect(ids).toContain('2n2222');
    expect(ids).toContain('2n3904');
    expect(ids).toContain('bc547');
    expect(ids).toContain('2n3055');
  });

  it('contains standard BJT PNP models', () => {
    const ids = BJT_PNP_MODELS.map(m => m.id);
    expect(ids).toContain('generic');
    expect(ids).toContain('2n2907');
    expect(ids).toContain('2n3906');
    expect(ids).toContain('bc557');
    expect(ids).toContain('mj2955');
  });

  it('contains standard MOSFET models', () => {
    const nmosIds = MOSFET_NMOS_MODELS.map(m => m.id);
    expect(nmosIds).toContain('generic');
    expect(nmosIds).toContain('2n7000');
    expect(nmosIds).toContain('bs170');
    expect(nmosIds).toContain('irf540n');

    const pmosIds = MOSFET_PMOS_MODELS.map(m => m.id);
    expect(pmosIds).toContain('generic');
    expect(pmosIds).toContain('bss84');
    expect(pmosIds).toContain('irf9540');
  });

  it('contains standard Op-Amp models', () => {
    const ids = OPAMP_MODELS.map(m => m.id);
    expect(ids).toContain('ideal');
    expect(ids).toContain('lm741');
    expect(ids).toContain('lm358');
    expect(ids).toContain('tl072');
    expect(ids).toContain('mcp6002');
  });

  it('lookup helpers find models case-insensitively', () => {
    expect(getBjtModel('npn', '2N2222')?.name).toBe('2N2222');
    expect(getBjtModel('pnp', '2n3906')?.name).toBe('2N3906');
    expect(getMosfetModel('nmos', '2N7000')?.name).toBe('2N7000');
    expect(getMosfetModel('pmos', 'BSS84')?.name).toBe('BSS84');
    expect(getOpAmpModel('LM741')?.name).toBe('LM741');
  });
});

describe('BJT SPICE netlist generation', () => {
  it('generates baseline default model for legacy NPN node', () => {
    const nodes: Node[] = [
      { id: 'q1', type: 'npn', position: { x: 0, y: 0 }, data: {} },
    ];
    const { netlist } = generateSpiceNetlist(nodes, []);
    expect(netlist).toContain('Q_q1');
    expect(netlist).toContain('.model NPN_MODEL_q1 NPN(IS=1e-14 VAF=100 BF=300 IKF=0.4 XTB=1.5 BR=3 CJC=2p CJE=4p TR=40n TF=0.4n RB=10)');
  });

  it('generates 2N2222 model parameters correctly', () => {
    const m = getBjtModel('npn', '2n2222')!;
    const nodes: Node[] = [
      {
        id: 'q1',
        type: 'npn',
        position: { x: 0, y: 0 },
        data: {
          model: '2n2222',
          bf: m.bf,
          is: m.is,
          vaf: m.vaf,
          rb: m.rb,
          cjc: m.cjc,
          cje: m.cje,
          ikf: m.ikf,
        },
      },
    ];
    const { netlist } = generateSpiceNetlist(nodes, []);
    expect(netlist).toContain('.model NPN_MODEL_q1 NPN(IS=1.4e-14 VAF=74 BF=200 IKF=0.5 XTB=1.5 BR=3 CJC=8p CJE=25p TR=40n TF=0.4n RB=10)');
  });

  it('generates custom parameters for PNP transistor', () => {
    const nodes: Node[] = [
      {
        id: 'q2',
        type: 'pnp',
        position: { x: 0, y: 0 },
        data: {
          bf: 150,
          vaf: 85,
          is: 2e-14,
          rb: 12,
          cjc: '6p',
          cje: '12p',
          ikf: 0.3,
        },
      },
    ];
    const { netlist } = generateSpiceNetlist(nodes, []);
    expect(netlist).toContain('.model PNP_MODEL_q2 PNP(IS=2e-14 VAF=85 BF=150 IKF=0.3 XTB=1.5 BR=3 CJC=6p CJE=12p TR=40n TF=0.4n RB=12)');
  });
});

describe('MOSFET SPICE netlist generation', () => {
  it('generates baseline default model for legacy NMOS node', () => {
    const nodes: Node[] = [
      { id: 'm1', type: 'nmos', position: { x: 0, y: 0 }, data: {} },
    ];
    const { netlist } = generateSpiceNetlist(nodes, []);
    expect(netlist).toContain('M_m1');
    expect(netlist).toContain('.model NMOS_MODEL_m1 NMOS(LEVEL=1 VTO=2 KP=0.05 GAMMA=0.5 PHI=0.6 LAMBDA=0.01 RD=0 RS=0)');
  });

  it('generates 2N7000 model parameters including on-resistance and capacitances', () => {
    const m = getMosfetModel('nmos', '2n7000')!;
    const nodes: Node[] = [
      {
        id: 'm1',
        type: 'nmos',
        position: { x: 0, y: 0 },
        data: {
          model: '2n7000',
          vto: m.vto,
          kp: m.kp,
          lambda: m.lambda,
          rd: m.rd,
          rs: m.rs,
          cgs: m.cgs,
          cgd: m.cgd,
        },
      },
    ];
    const { netlist } = generateSpiceNetlist(nodes, []);
    expect(netlist).toContain('.model NMOS_MODEL_m1 NMOS(LEVEL=1 VTO=2.1 KP=0.12 GAMMA=0.5 PHI=0.6 LAMBDA=0.02 RD=1.2 RS=1.2 CGS=25p CGD=5p)');
  });

  it('generates IRF9540 power PMOS model', () => {
    const m = getMosfetModel('pmos', 'irf9540')!;
    const nodes: Node[] = [
      {
        id: 'm2',
        type: 'pmos',
        position: { x: 0, y: 0 },
        data: {
          model: 'irf9540',
          vto: m.vto,
          kp: m.kp,
          lambda: m.lambda,
          rd: m.rd,
          rs: m.rs,
          cgs: m.cgs,
          cgd: m.cgd,
        },
      },
    ];
    const { netlist } = generateSpiceNetlist(nodes, []);
    expect(netlist).toContain('.model PMOS_MODEL_m2 PMOS(LEVEL=1 VTO=-3.5 KP=0.8 GAMMA=0.5 PHI=0.6 LAMBDA=0.005 RD=0.058 RS=0.058 CGS=1.1n CGD=150p)');
  });
});

describe('Op-Amp SPICE netlist & macromodel generation', () => {
  it('generates ideal rail-to-rail macromodel for default node', () => {
    const nodes: Node[] = [
      { id: 'oa1', type: 'opamp', position: { x: 0, y: 0 }, data: {} },
    ];
    const { netlist } = generateSpiceNetlist(nodes, []);
    expect(netlist).toContain('X_oa1');
    expect(netlist).toContain('OPAMP_MODEL_oa1');
    expect(netlist).toContain('.SUBCKT OPAMP_MODEL_oa1 1 2 3 4 5');
    expect(netlist).toContain('Rin 1 2 100MEG');
    expect(netlist).toContain('E1 6 0 1 2 100000');
    expect(netlist).toContain('B1 5 0 V=V(6) > V(3) ? V(3) : (V(6) < V(4) ? V(4) : V(6))');
    expect(netlist).toContain('.ENDS OPAMP_MODEL_oa1');
    // Also retains legacy IDEAL_OPAMP subcircuit
    expect(netlist).toContain('.SUBCKT IDEAL_OPAMP 1 2 3 4 5');
  });

  it('generates LM741 macromodel with dominant pole and rail headroom offsets', () => {
    const m = getOpAmpModel('lm741')!;
    const nodes: Node[] = [
      {
        id: 'oa1',
        type: 'opamp',
        position: { x: 0, y: 0 },
        data: {
          model: 'lm741',
          gain: m.gain,
          gbw: m.gbw,
          rin: m.rin,
          rout: m.rout,
          vRailDropHi: m.vRailDropHi,
          vRailDropLo: m.vRailDropLo,
        },
      },
    ];
    const { netlist } = generateSpiceNetlist(nodes, []);
    expect(netlist).toContain('.SUBCKT OPAMP_MODEL_oa1 1 2 3 4 5');
    expect(netlist).toContain('Rin 1 2 2MEG');
    expect(netlist).toContain('E1 6 0 1 2 200000');
    expect(netlist).toContain('Rpole 6 7 100k');
    expect(netlist).toContain('Cpole 7 0');
    // Headroom: positive rail - 2V, negative rail + 2V
    expect(netlist).toContain('(V(3) - 2)');
    expect(netlist).toContain('(V(4) + 2)');
    // Output resistance: 75 ohms
    expect(netlist).toContain('Rout 8 5 75');
  });

  it('generates LM358 single-supply model with ground-sensing headroom', () => {
    const m = getOpAmpModel('lm358')!;
    const nodes: Node[] = [
      {
        id: 'oa1',
        type: 'opamp',
        position: { x: 0, y: 0 },
        data: {
          model: 'lm358',
          gain: m.gain,
          gbw: m.gbw,
          rin: m.rin,
          rout: m.rout,
          vRailDropHi: m.vRailDropHi,
          vRailDropLo: m.vRailDropLo,
        },
      },
    ];
    const { netlist } = generateSpiceNetlist(nodes, []);
    expect(netlist).toContain('.SUBCKT OPAMP_MODEL_oa1 1 2 3 4 5');
    expect(netlist).toContain('Rin 1 2 10MEG');
    expect(netlist).toContain('(V(3) - 1.5)');
    expect(netlist).toContain('(V(4) + 0.05)');
    expect(netlist).toContain('Rout 8 5 50');
  });
});
