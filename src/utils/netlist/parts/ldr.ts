import type { PartEmitter } from '../part';
import { pwlSource } from '../values';
import { parseEngValue } from '../../engValue';

export const ldr: PartEmitter = {
  emit: (node, { net }) => {
    const n1 = net('in');
    const n2 = net('out');
    /*
     * `r_dark` is stored as the sanitized *label* — the properties panel
     * writes sanitizeSpiceValue("100k"), which is "100k". parseFloat read
     * that as 100, so every LDR whose dark resistance had ever been edited
     * simulated as a 100 ohm resistor. parseEngValue is what reads a
     * component value everywhere else on the canvas, suffix and all.
     */
    const rDark = parseEngValue(String(node.data.r_dark ?? '')) ?? 100000;
    const lightLevel = node.data.lightLevel !== undefined ? Number(node.data.lightLevel) : 0;

    const pwlData = node.data.pwlData as { t: number; v: number }[] | undefined;
    if (pwlData && pwlData.length > 0) {
      return pwlSource(`V_light_${node.id} light_node_${node.id} 0`, pwlData)
        + `B_ldr_${node.id} ${n1} ${n2} I = V(${n1}, ${n2}) / (100 + (${rDark} - 100) * (1 - V(light_node_${node.id})))\n`;
    }
    const resVal = 100 + (rDark - 100) * (1 - lightLevel);
    return `R_${node.id} ${n1} ${n2} ${resVal.toFixed(2)}\n`;
  },
};
