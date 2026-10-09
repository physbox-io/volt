import type { PartEmitter } from '../part';
import { pwlSource } from '../values';
import { getEffectiveMcuConfig } from '../../mcuConfig';

export const mcu: PartEmitter = {
  emit: (node, { net, mcuDrive }) => {
    // With no drive every pin takes the input branch below, an idle GPIO:
    // the right model for a bias point or a small-signal sweep.
    const { pwlOutputs, pinModes } = mcuDrive ?? { pwlOutputs: {}, pinModes: {} };
    let cards = '';

    for (const pin of getEffectiveMcuConfig(node.data).pins) {
      const pinId = pin.id;
      const pinNet = net(pinId);

      if (pin.type === 'power' || pinId === '5V' || pinId === '3V3' || pinId === 'VCC' || pinId === 'VIN' || pin.voltage !== undefined) {
        const vLevel = pin.voltage !== undefined ? pin.voltage : (pinId === '3V3' ? 3.3 : 5.0);
        const intPowerNet = `int_mcu_${node.id}_${pinId}`;
        cards += `V_${node.id}_${pinId} ${intPowerNet} 0 DC ${vLevel}\n`;
        cards += `R_${node.id}_${pinId}_res ${intPowerNet} ${pinNet} 1\n`;
      } else if (pin.type === 'ground' || pinId === 'GND' || pinId.startsWith('GND')) {
        cards += `R_${node.id}_${pinId} ${pinNet} 0 1m\n`;
      } else if (pinModes[pinId] === 'OUTPUT' && pwlOutputs[pinId] && pwlOutputs[pinId].length > 0) {
        // Output pin driving voltage, through 20 ohms (typical for MCU GPIO).
        // The sketch's times are in ms.
        const intNet = `int_mcu_${node.id}_${pinId}`;
        cards += pwlSource(`V_${node.id}_${pinId} ${intNet} 0`, pwlOutputs[pinId].map(p => ({ t: p.t / 1000, v: p.v })));
        cards += `R_${node.id}_${pinId}_out ${intNet} ${pinNet} 20\n`;
      } else {
        // Input pin (or unconfigured), 100M resistor to ground to prevent floating
        cards += `R_${node.id}_${pinId} ${pinNet} 0 100MEG\n`;
      }
    }
    return cards;
  },
};
