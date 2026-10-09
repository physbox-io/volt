import type { PartEmitter } from '../part';
import { resolveOpAmpParams } from '../../deviceModels';

export const opamp: PartEmitter = {
  emit: (node, { net }) => {
    const in_non = net('in_non');
    const in_inv = net('in_inv');
    const vcc = net('vcc');
    const vee = net('vee');
    const out = net('out');
    return `X_${node.id} ${in_non} ${in_inv} ${vcc} ${vee} ${out} OPAMP_MODEL_${node.id}\n`;
  },
  library: parts => {
    let lib = `
* Idealized Op-Amp Macro Model (Legacy compatibility)
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

    for (const node of parts) {
      const resolved = resolveOpAmpParams(node.data);
      const { gain, gbw, rin, rout } = resolved;
      const dropHi = Math.max(0, resolved.vRailDropHi);
      const dropLo = Math.max(0, resolved.vRailDropLo);

      const upperLimit = dropHi > 0 ? `(V(3) - ${dropHi})` : `V(3)`;
      const lowerLimit = dropLo > 0 ? `(V(4) + ${dropLo})` : `V(4)`;

      lib += `
* Parameterized Op-Amp Subcircuit for ${node.id}
* Node order: IN+ IN- VCC VEE OUT
.SUBCKT OPAMP_MODEL_${node.id} 1 2 3 4 5
Rin 1 2 ${rin}
E1 6 0 1 2 ${gain}
`;

      const internalDrive = rout > 0.01 ? '8' : '5';

      if (gbw > 0) {
        // Dominant pole for GBW roll-off: fp = GBW / gain.
        // With Rpole = 100k, Cpole = gain / (2 * pi * GBW * 100000).
        const cpoleVal = gain / (2 * Math.PI * gbw * 100000);
        const cpole = cpoleVal < 1e-12 ? `${(cpoleVal * 1e12).toFixed(4)}p` : cpoleVal.toExponential(6);
        lib += `Rpole 6 7 100k\n`;
        lib += `Cpole 7 0 ${cpole}\n`;
        lib += `B1 ${internalDrive} 0 V=V(7) > ${upperLimit} ? ${upperLimit} : (V(7) < ${lowerLimit} ? ${lowerLimit} : V(7))\n`;
      } else {
        lib += `B1 ${internalDrive} 0 V=V(6) > ${upperLimit} ? ${upperLimit} : (V(6) < ${lowerLimit} ? ${lowerLimit} : V(6))\n`;
      }

      if (rout > 0.01) {
        lib += `Rout 8 5 ${rout}\n`;
      }

      lib += `.ENDS OPAMP_MODEL_${node.id}\n`;
    }
    return lib;
  },
};
