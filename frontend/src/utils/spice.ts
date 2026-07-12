import { type Node, type Edge } from '@xyflow/react';
import { executeMcuCode, type PWLPoint } from './mcu';

/** Strip Unicode symbols from component labels to produce valid SPICE values.
 *  e.g. '47kΩ' → '47k', '10µF' → '10uF' */
export function sanitizeSpiceValue(val: string): string {
  // 1. Replace symbols
  let cleaned = val.replace(/Ω/g, '').replace(/µ/g, 'u').trim();
  // 2. Extract leading numeric part with potential SI suffix (e.g. 10k, 4.7, 100u, 5V)
  const match = cleaned.match(/^([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?[a-zA-Z]*)/);
  if (match) return match[1];
  
  return cleaned.replace(/[^\x20-\x7E]/g, '');
}

export function generateSpiceNetlist(nodes: Node[], edges: Edge[], simLength: number = 1.0, simResolution: 'normal' | 'high' = 'normal', mcuWaveforms: Record<string, Record<string, PWLPoint[]>> = {}, initialConditions?: Record<string, number>): { netlist: string; portToNet: Record<string, string>; mcuLogs: Record<string, string[]> } {
  let netlist = "Circuit Simulation\n";
  const mcuLogs: Record<string, string[]> = {};
  
  // 1. Map connections to nets
  // We'll use a Union-Find or a simple adjacency list to group connected ports into 'nets'.
  // A port is defined by `${node.id}-${handle}`.
  let netIdCounter = 1;
  const portToNet: Record<string, string> = {};

  // Initialize each edge connection as a net
  edges.forEach(edge => {
    const sourcePort = `${edge.source}-${edge.sourceHandle || 'out'}`;
    const targetPort = `${edge.target}-${edge.targetHandle || 'in'}`;
    
    let sourceNet = portToNet[sourcePort];
    let targetNet = portToNet[targetPort];

    if (!sourceNet && !targetNet) {
      const netId = `N${netIdCounter++}`;
      portToNet[sourcePort] = netId;
      portToNet[targetPort] = netId;
    } else if (sourceNet && !targetNet) {
      portToNet[targetPort] = sourceNet;
    } else if (!sourceNet && targetNet) {
      portToNet[sourcePort] = targetNet;
    } else if (sourceNet !== targetNet) {
      // Merge nets (simplistic, assumes no complex graphs for now, better to use proper disjoint set if it gets complex)
      Object.keys(portToNet).forEach(port => {
        if (portToNet[port] === targetNet) {
          portToNet[port] = sourceNet;
        }
      });
    }
  });

  // Force ground to be net '0'
  const groundNodes = nodes.filter(n => n.type === 'ground');
  groundNodes.forEach(gNode => {
    const groundPortIn = `${gNode.id}-in`;
    const net = portToNet[groundPortIn];
    if (net) {
      Object.keys(portToNet).forEach(port => {
        if (portToNet[port] === net) {
          portToNet[port] = '0';
        }
      });
    } else {
       portToNet[groundPortIn] = '0';
    }
  });

  const unconnectedNets = new Set<string>();
  // Helper to get net for a node's handle
  const getNet = (nodeId: string, handleId: string) => {
    const port = `${nodeId}-${handleId}`;
    if (portToNet[port]) {
      return portToNet[port];
    }
    const ncNet = `NC_${nodeId}_${handleId}`;
    unconnectedNets.add(ncNet);
    return ncNet;
  };

  let has555 = false;
  let hasOpAmp = false;
  let hasAudio = false;
  let hasDff = false;
  // 2. Generate SPICE statements for each node
  nodes.forEach(node => {
    if (node.type === 'resistor') {
      const val = node.data.resistance !== undefined ? node.data.resistance : sanitizeSpiceValue(String(node.data.label || '1k'));
      const n1 = getNet(node.id, 'in');
      const n2 = getNet(node.id, 'out');
      netlist += `R_${node.id} ${n1} ${n2} ${val}\n`;
    } 
    else if (node.type === 'capacitor') {
      const val = node.data.capacitance !== undefined ? node.data.capacitance : sanitizeSpiceValue(String(node.data.label || '10u'));
      const n1 = getNet(node.id, 'in');
      const n2 = getNet(node.id, 'out');
      netlist += `C_${node.id} ${n1} ${n2} ${val}\n`;
    }
    else if (node.type === 'inductor') {
      const val = node.data.inductance !== undefined ? node.data.inductance : sanitizeSpiceValue(String(node.data.label || '100u'));
      const n1 = getNet(node.id, 'in');
      const n2 = getNet(node.id, 'out');
      netlist += `L_${node.id} ${n1} ${n2} ${val}\n`;
    }
    else if (node.type === 'voltage') {
      const val = node.data.voltage !== undefined ? node.data.voltage : sanitizeSpiceValue(String(node.data.label || '5'));
      const n1 = getNet(node.id, 'pos');
      const n2 = getNet(node.id, 'neg');
      netlist += `V_${node.id} ${n1} ${n2} DC ${val}\n`;
    }
    else if (node.type === 'acvoltage') {
      const amp = node.data.amplitude !== undefined ? Number(node.data.amplitude) : 10;
      const freq = node.data.frequency !== undefined ? Number(node.data.frequency) : 60;
      const n1 = getNet(node.id, 'pos');
      const n2 = getNet(node.id, 'neg');
      netlist += `V_${node.id} ${n1} ${n2} SINE(0 ${amp} ${freq})\n`;
    }
    else if (node.type === 'led') {
      const n1 = getNet(node.id, 'anode');
      const n2 = getNet(node.id, 'cathode');
      // Dummy 1-ohm resistor to measure branch current
      netlist += `R_ammeter_${node.id} ${n1} int_led_${node.id} 1\n`;
      netlist += `D_${node.id} int_led_${node.id} ${n2} LED_MODEL_${node.id}\n`;
      
      const v_drop = Number(node.data.v_drop || 2.0);
      const n_coeff = v_drop / 1.2;
      netlist += `.model LED_MODEL_${node.id} D(IS=1e-22 RS=5 N=${n_coeff})\n`;

      if (node.data.photodiodeMode) {
        const lightLevel = node.data.lightLevel !== undefined ? Number(node.data.lightLevel) : 0;
        const sensitivity = Number(node.data.lightSensitivity !== undefined ? node.data.lightSensitivity : 10) * 1e-6; // default 10uA
        const photoCurrent = lightLevel * sensitivity;
        netlist += `I_photo_${node.id} ${n2} int_led_${node.id} DC ${photoCurrent.toExponential(6)}\n`;
      }
    }
    else if (node.type === 'diode') {
      const n1 = getNet(node.id, 'anode');
      const n2 = getNet(node.id, 'cathode');
      const v_drop = Number(node.data.v_drop || 0.7);
      const n_coeff = v_drop / 0.7;
      netlist += `D_${node.id} ${n1} ${n2} DIODE_MODEL_${node.id}\n`;
      netlist += `.model DIODE_MODEL_${node.id} D(IS=1e-14 RS=0.1 N=${n_coeff})\n`;
    }
    else if (node.type === 'zener') {
      const n1 = getNet(node.id, 'anode');
      const n2 = getNet(node.id, 'cathode');
      const bv = sanitizeSpiceValue(String(node.data.label || '5.1V')).replace(/[Vv]$/, '');
      netlist += `D_${node.id} ${n1} ${n2} ZENER_MODEL_${node.id}\n`;
      netlist += `.model ZENER_MODEL_${node.id} D(IS=1e-11 BV=${bv} IBV=1e-3)\n`;
    }
    else if (node.type === 'switch') {
      const n1 = getNet(node.id, 'in');
      const n2 = getNet(node.id, 'out');
      const isOpen = node.data.isOpen !== false;
      const res = isOpen ? '1e12' : '0.01';
      netlist += `R_${node.id} ${n1} ${n2} ${res}\n`;
    }
    else if (node.type === 'opamp') {
      hasOpAmp = true;
      const in_non = getNet(node.id, 'in_non');
      const in_inv = getNet(node.id, 'in_inv');
      const vcc = getNet(node.id, 'vcc');
      const vee = getNet(node.id, 'vee');
      const out = getNet(node.id, 'out');
      netlist += `X_${node.id} ${in_non} ${in_inv} ${vcc} ${vee} ${out} IDEAL_OPAMP\n`;
    }
    else if (node.type === 'timer555') {
      has555 = true;
      // Pins: 1:GND, 2:TRIG, 3:OUT, 4:RESET, 5:CTRL, 6:THR, 7:DIS, 8:VCC
      const gnd = getNet(node.id, '1');
      const trig = getNet(node.id, '2');
      const out = getNet(node.id, '3');
      const rst = getNet(node.id, '4');
      const ctrl = getNet(node.id, '5');
      const thr = getNet(node.id, '6');
      const dis = getNet(node.id, '7');
      const vcc = getNet(node.id, '8');
      
      // Syntax: Xname GND TRIG OUT RST CTRL THR DIS VCC modelname
      netlist += `X_${node.id} ${gnd} ${trig} ${out} ${rst} ${ctrl} ${thr} ${dis} ${vcc} NE555\n`;
    }
    else if (node.type === 'multimeter') {
      const n1 = getNet(node.id, 'pos');
      const n2 = getNet(node.id, 'neg');
      if (node.data.mode === 'current') {
        netlist += `V_ammeter_${node.id} ${n1} ${n2} DC 0\n`;
      } else {
        netlist += `R_${node.id} ${n1} ${n2} 1G\n`;
      }
    }
    else if (node.type === 'signalgen') {
      const freq = Number(node.data.frequency || 1);
      const amp = node.data.amplitude || 5;
      const duty = (node.data.dutyCycle !== undefined ? Number(node.data.dutyCycle) : 50) / 100;
      // For square waves, use a 0-to-amp pulse with configurable duty cycle
      // We use very small rise/fall times relative to frequency
      const trf = Math.min(1e-6, 0.01 / freq); 
      const type = node.data.waveform === 'square' 
        ? `PULSE(0 ${amp} 0 ${trf} ${trf} ${duty/freq} ${1/freq})` 
        : `SINE(0 ${amp} ${freq})`;
      const n1 = getNet(node.id, 'out');
      const n2 = getNet(node.id, 'gnd');
      netlist += `V_${node.id} ${n1} ${n2} ${type}\n`;
    }
    else if (node.type === 'scope') {
      const n1 = getNet(node.id, 'in');
      const n2 = getNet(node.id, 'gnd');
      netlist += `R_${node.id} ${n1} ${n2} 1G\n`;
    }
    else if (node.type === 'potentiometer') {
      const rawLabel = String(node.data.label || '10k');
      const totalRStr = sanitizeSpiceValue(rawLabel);
      // Parse numeric value with SI suffix for splitting
      let totalR = parseFloat(totalRStr) || 10000;
      const suffix = totalRStr.replace(/[0-9.eE\-+]/g, '').toLowerCase();
      if (suffix === 'k') totalR *= 1000;
      else if (suffix === 'meg' || suffix === 'm' && totalRStr.toLowerCase().endsWith('meg')) totalR *= 1e6;
      else if (suffix === 'm') totalR /= 1000;
      else if (suffix === 'u') totalR /= 1e6;
      const pos = Math.max(0.001, Math.min(0.999, (Number(node.data.position) || 50) / 100));
      const nIn = getNet(node.id, 'in');
      const nOut = getNet(node.id, 'out');
      const nWiper = getNet(node.id, 'wiper');
      const rTop = totalR * (1 - pos);
      const rBot = totalR * pos;
      netlist += `R_${node.id}_top ${nIn} ${nWiper} ${rTop}\n`;
      netlist += `R_${node.id}_bot ${nWiper} ${nOut} ${rBot}\n`;
    }
    else if (node.type === 'sevenseg') {
      const nCommon = getNet(node.id, 'common');
      const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      segs.forEach(s => {
        const nSeg = getNet(node.id, s);
        netlist += `R_${node.id}_${s} ${nSeg} ${nCommon} 1G\n`;
      });
    }
    else if (node.type === 'currentsource') {
      const val = sanitizeSpiceValue(String(node.data.label || '10m'));
      const nPos = getNet(node.id, 'pos');
      const nNeg = getNet(node.id, 'neg');
      netlist += `I_${node.id} ${nPos} ${nNeg} DC ${val}\n`;
    }
    else if (node.type === 'speaker') {
      const n1 = getNet(node.id, 'in');
      const n2 = getNet(node.id, 'gnd');
      netlist += `R_${node.id} ${n1} ${n2} 8\n`; // 8 ohm speaker load
      hasAudio = true;
    }
    else if (node.type === 'microphone') {
      const n1 = getNet(node.id, 'out');
      const n2 = getNet(node.id, 'gnd');
      const pwlData = node.data.pwlData as { t: number; v: number }[] | undefined;
      const gain = Number(node.data.amplification ?? 100);
      if (pwlData && pwlData.length > 0) hasAudio = true;
      // Raw audio values are normalized -1..+1
      // Apply gain as a voltage multiplier: gain=100 → raw * 0.05 * 100 = ±5V peak
      const voltageScale = 0.05 * gain; // 0.05V base (electret mic level) × gain
      if (pwlData && pwlData.length > 0) {
        // Build PWL with line continuations to avoid exceeding Ngspice's line buffer (~1024 chars)
        const POINTS_PER_LINE = 8;
        let pwlLines = `V_${node.id} ${n1} ${n2} PWL(\n`;
        for (let i = 0; i < pwlData.length; i++) {
          const p = pwlData[i];
          if (i % POINTS_PER_LINE === 0) {
            pwlLines += '+ ';
          }
          const scaledV = p.v * voltageScale;
          pwlLines += `${p.t.toExponential(6)} ${scaledV.toExponential(6)} `;
          if ((i + 1) % POINTS_PER_LINE === 0 || i === pwlData.length - 1) {
            pwlLines += '\n';
          }
        }
        pwlLines += '+ )\n';
        netlist += pwlLines;
      } else {
        netlist += `V_${node.id} ${n1} ${n2} DC 0\n`;
      }
    }
    else if (node.type === 'npn') {
      const nc = getNet(node.id, 'c');
      const nb = getNet(node.id, 'b');
      const ne = getNet(node.id, 'e');
      const bf = node.data.bf || 300;
      netlist += `Q_${node.id} ${nc} ${nb} ${ne} NPN_MODEL_${node.id}\n`;
      netlist += `.model NPN_MODEL_${node.id} NPN(IS=1e-14 VAF=100 BF=${bf} IKF=0.4 XTB=1.5 BR=3 CJC=8e-12 CJE=25e-12 TR=100e-9 TF=400e-12 ITF=1 VTF=2 XTF=3 RB=10)\n`;
    }
    else if (node.type === 'pnp') {
      const nc = getNet(node.id, 'c');
      const nb = getNet(node.id, 'b');
      const ne = getNet(node.id, 'e');
      const bf = node.data.bf || 300;
      netlist += `Q_${node.id} ${nc} ${nb} ${ne} PNP_MODEL_${node.id}\n`;
      netlist += `.model PNP_MODEL_${node.id} PNP(IS=1e-14 VAF=100 BF=${bf} IKF=0.4 XTB=1.5 BR=3 CJC=8e-12 CJE=25e-12 TR=100e-9 TF=400e-12 ITF=1 VTF=2 XTF=3 RB=10)\n`;
    }
    else if (node.type === 'nmos') {
      const nd = getNet(node.id, 'd');
      const ng = getNet(node.id, 'g');
      const ns = getNet(node.id, 's');
      const vto = node.data.vto !== undefined ? node.data.vto : 2.0;
      const kp = node.data.kp !== undefined ? node.data.kp : 0.05;
      netlist += `M_${node.id} ${nd} ${ng} ${ns} ${ns} NMOS_MODEL_${node.id}\n`;
      netlist += `.model NMOS_MODEL_${node.id} NMOS(LEVEL=1 VTO=${vto} KP=${kp} GAMMA=0.5 PHI=0.6 LAMBDA=0.01)\n`;
    }
    else if (node.type === 'pmos') {
      const nd = getNet(node.id, 'd');
      const ng = getNet(node.id, 'g');
      const ns = getNet(node.id, 's');
      const vto = node.data.vto !== undefined ? node.data.vto : -2.0;
      const kp = node.data.kp !== undefined ? node.data.kp : 0.02;
      netlist += `M_${node.id} ${nd} ${ng} ${ns} ${ns} PMOS_MODEL_${node.id}\n`;
      netlist += `.model PMOS_MODEL_${node.id} PMOS(LEVEL=1 VTO=${vto} KP=${kp} GAMMA=0.5 PHI=0.6 LAMBDA=0.01)\n`;
    }
    else if (['and', 'or', 'nand', 'nor', 'xor'].includes(node.type)) {
      const in1 = getNet(node.id, 'in1');
      const in2 = getNet(node.id, 'in2');
      const out = getNet(node.id, 'out');
      let bSourceExpr = '';
      if (node.type === 'and') bSourceExpr = `V(${in1}) > 2.5 ? (V(${in2}) > 2.5 ? 5 : 0) : 0`;
      else if (node.type === 'or') bSourceExpr = `V(${in1}) > 2.5 ? 5 : (V(${in2}) > 2.5 ? 5 : 0)`;
      else if (node.type === 'nand') bSourceExpr = `V(${in1}) > 2.5 ? (V(${in2}) > 2.5 ? 0 : 5) : 5`;
      else if (node.type === 'nor') bSourceExpr = `V(${in1}) > 2.5 ? 0 : (V(${in2}) > 2.5 ? 0 : 5)`;
      else if (node.type === 'xor') bSourceExpr = `V(${in1}) > 2.5 ? (V(${in2}) > 2.5 ? 0 : 5) : (V(${in2}) > 2.5 ? 5 : 0)`;
      
      netlist += `B_gate_${node.id} ${out} 0 V = ${bSourceExpr}\n`;
    }
    else if (node.type === 'not') {
      const in1 = getNet(node.id, 'in1');
      const out = getNet(node.id, 'out');
      netlist += `B_gate_${node.id} ${out} 0 V = V(${in1}) > 2.5 ? 0 : 5\n`;
    }
    else if (node.type === 'mcu') {
      const code = (node.data.code as string) || '';
      const inputWaveforms = mcuWaveforms[node.id] || {};
      const { pwlOutputs, pinModes, logs } = executeMcuCode(code, simLength, inputWaveforms);
      mcuLogs[node.id] = logs;

      const pins = ['D0', 'D1', 'D2', 'D3', 'A0', 'A1'];
      for (const pin of pins) {
        const net = getNet(node.id, pin);
        if (pinModes[pin] === 'OUTPUT' && pwlOutputs[pin] && pwlOutputs[pin].length > 0) {
          // Output pin driving voltage
          const pwlData = pwlOutputs[pin];
          const POINTS_PER_LINE = 8;
          const intNet = `int_mcu_${node.id}_${pin}`;
          let pwlLines = `V_${node.id}_${pin} ${intNet} 0 PWL(\n`;
          for (let i = 0; i < pwlData.length; i++) {
            const p = pwlData[i];
            if (i % POINTS_PER_LINE === 0) pwlLines += '+ ';
            pwlLines += `${(p.t / 1000).toExponential(6)} ${p.v.toExponential(6)} `;
            if ((i + 1) % POINTS_PER_LINE === 0 || i === pwlData.length - 1) pwlLines += '\n';
          }
          pwlLines += '+ )\n';
          // Add 20 ohm series resistor for output (typical for Arduino GPIO)
          netlist += pwlLines;
          netlist += `R_${node.id}_${pin}_out ${intNet} ${net} 20\n`;
        } else {
          // Input pin (or unconfigured), 100M resistor to ground to prevent floating
          netlist += `R_${node.id}_${pin} ${net} 0 100MEG\n`;
        }
      }
      // VCC and GND pins
      const vccNet = getNet(node.id, '5V');
      const gndNet = getNet(node.id, 'GND');
      const int5VNet = `int_mcu_${node.id}_5V`;
      netlist += `V_${node.id}_5V ${int5VNet} 0 DC 5\n`;
      netlist += `R_${node.id}_5V_res ${int5VNet} ${vccNet} 1\n`; // 1 ohm to avoid singular matrix with other 5V sources
      netlist += `R_${node.id}_GND ${gndNet} 0 1m\n`;
    }
    else if (node.type === 'transformer') {
      const p1 = getNet(node.id, 'p1');
      const p2 = getNet(node.id, 'p2');
      const s1 = getNet(node.id, 's1');
      const s2 = getNet(node.id, 's2');
      const lpri = node.data.l_pri !== undefined ? node.data.l_pri : sanitizeSpiceValue(String(node.data.l_pri_label || '10mH'));
      const lsec = node.data.l_sec !== undefined ? node.data.l_sec : sanitizeSpiceValue(String(node.data.l_sec_label || '10mH'));
      const k = node.data.k !== undefined ? node.data.k : '0.99';
      netlist += `L_pri_${node.id} ${p1} ${p2} ${lpri}\n`;
      netlist += `L_sec_${node.id} ${s1} ${s2} ${lsec}\n`;
      netlist += `K_${node.id} L_pri_${node.id} L_sec_${node.id} ${k}\n`;
    }
    else if (node.type === 'dff') {
      hasDff = true;
      const d = getNet(node.id, 'd');
      const clk = getNet(node.id, 'clk');
      const q = getNet(node.id, 'q');
      const qbar = getNet(node.id, 'qbar');
      netlist += `X_${node.id} ${d} ${clk} ${q} ${qbar} DFF\n`;
    }
    else if (node.type === 'ldr') {
      const n1 = getNet(node.id, 'in');
      const n2 = getNet(node.id, 'out');
      const rDark = node.data.r_dark !== undefined ? parseFloat(sanitizeSpiceValue(String(node.data.r_dark))) : 100000;
      const lightLevel = node.data.lightLevel !== undefined ? Number(node.data.lightLevel) : 0;
      
      const pwlData = node.data.pwlData as { t: number; v: number }[] | undefined;
      if (pwlData && pwlData.length > 0) {
        const POINTS_PER_LINE = 8;
        let pwlLines = `V_light_${node.id} light_node_${node.id} 0 PWL(\n`;
        for (let i = 0; i < pwlData.length; i++) {
          const p = pwlData[i];
          if (i % POINTS_PER_LINE === 0) pwlLines += '+ ';
          pwlLines += `${p.t.toExponential(6)} ${p.v.toExponential(6)} `;
          if ((i + 1) % POINTS_PER_LINE === 0 || i === pwlData.length - 1) pwlLines += '\n';
        }
        pwlLines += '+ )\n';
        netlist += pwlLines;
        netlist += `B_ldr_${node.id} ${n1} ${n2} I = V(${n1}, ${n2}) / (100 + (${rDark} - 100) * (1 - V(light_node_${node.id})))\n`;
      } else {
        const resVal = 100 + (rDark - 100) * (1 - lightLevel);
        netlist += `R_${node.id} ${n1} ${n2} ${resVal.toFixed(2)}\n`;
      }
    }
  });
  
  // (Logic gates now use native B-sources, no XSPICE .model required)

  if (hasOpAmp) {
    netlist += `
* Idealized Op-Amp Macro Model
* Node order: IN+ IN- VCC VEE OUT
.SUBCKT IDEAL_OPAMP 1 2 3 4 5
* High input impedance
Rin 1 2 100MEG
* Voltage controlled voltage source for gain (Gain = 100k)
E1 6 0 1 2 100k
* Output clipping to power rails
B1 5 0 V=V(6) > V(3) ? V(3) : (V(6) < V(4) ? V(4) : V(6))
.ENDS IDEAL_OPAMP
`;
  }

  if (has555) {
    // Basic NE555 macro model (idealized for speed)
    netlist += `
* Idealized NE555 Timer Macro Model
* Node order: GND TRIG OUT RST CTRL THR DIS VCC
.SUBCKT NE555 1 2 3 4 5 6 7 8
* Voltage divider
R1 8 5 5k
R2 5 61 5k
R3 61 1 5k

* Smooth SR Latch Integrator
* Instead of G-source integrating to infinity, use standard switches to charge/discharge a capacitor
S_SET 8 state 61 2 SMOD_ON
S_RST state 1 6 5 SMOD_ON
C1 state 1 100p
* Add parallel resistor to guarantee DC convergence
R4 state 1 100MEG

* Output buffer
E_OUT 3 1 VOL={V(state)>2.5 ? V(8) : 0}

* Discharge
S_DIS 7 1 8 state SMOD_DIS

.MODEL SMOD_ON SW(VT=0 RON=1k ROFF=100MEG)
.MODEL SMOD_DIS SW(VT=2.5 RON=10 ROFF=100MEG)
.ENDS NE555
`;
  }

  if (hasDff) {
    netlist += `
* Idealized Master-Slave D Flip-Flop
* Node order: D CLK Q QBAR
.SUBCKT DFF D CLK Q QBAR
B_CLK_BAR clk_bar 0 V = 5 - V(CLK)

* Master Latch: closed when clk_bar > 2.5
S_M D state_m clk_bar 0 SMOD_DFF
C_M state_m 0 10n
R_M state_m 0 1G

* Buffer master to slave to prevent charge sharing between C_M and C_S
B_state_m_buf state_m_buf 0 V = V(state_m) > 2.5 ? 5 : 0

* Slave Latch: closed when CLK > 2.5
S_S state_m_buf state_s CLK 0 SMOD_DFF
C_S state_s 0 10n
R_S state_s 0 1G

* Output Drivers
B_Q Q 0 V = V(state_s) > 2.5 ? 5 : 0
B_QBAR QBAR 0 V = V(state_s) > 2.5 ? 0 : 5

.MODEL SMOD_DFF SW(VT=2.5 VH=0.2 RON=1k ROFF=1G)
.ENDS DFF
`;
  }
  
  // Shunt unconnected nodes to ground to prevent singular matrix errors
  unconnectedNets.forEach(net => {
    netlist += `R_shunt_${net} ${net} 0 1G\n`;
  });

  // Save all voltages to ensure they are returned
  netlist += `.save all\n`;
  
  // Apply initial conditions if present
  if (initialConditions && Object.keys(initialConditions).length > 0) {
    const icParts = Object.entries(initialConditions)
      .map(([net, val]) => `V(${net})=${val.toFixed(6)}`)
      .join(' ');
    if (icParts) {
      netlist += `.ic ${icParts}\n`;
    }
  }

  // Basic transient analysis (variable total)
  // Audio circuits need much finer time steps for proper frequency resolution
  if (hasAudio) {
    // 0.05ms step → 20kHz Nyquist → captures full audio bandwidth
    netlist += `.tran 0.05m ${simLength}s 0 0.05m\n`;
  } else if (simResolution === 'high') {
    netlist += `.tran 1m ${simLength}s 0 0.1m\n`;
  } else {
    netlist += `.tran 1m ${simLength}s uic\n`;
  }
  netlist += `.end\n`;

  return { netlist, portToNet, mcuLogs };
}
