import type { PartEmitter } from '../part';

export const led: PartEmitter = {
  emit: (node, { net }) => {
    const n1 = net('anode');
    const n2 = net('cathode');
    // Dummy 1-ohm resistor to measure branch current
    let cards = `R_ammeter_${node.id} ${n1} int_led_${node.id} 1\n`;
    cards += `D_${node.id} int_led_${node.id} ${n2} LED_MODEL_${node.id}\n`;

    const v_drop = Number(node.data.v_drop || 2.0);
    const n_coeff = v_drop / 1.2;
    cards += `.model LED_MODEL_${node.id} D(IS=1e-22 RS=5 N=${n_coeff})\n`;

    if (node.data.photodiodeMode) {
      const lightLevel = node.data.lightLevel !== undefined ? Number(node.data.lightLevel) : 0;
      const sensitivity = Number(node.data.lightSensitivity !== undefined ? node.data.lightSensitivity : 10) * 1e-6; // default 10uA
      const photoCurrent = lightLevel * sensitivity;
      cards += `I_photo_${node.id} ${n2} int_led_${node.id} DC ${photoCurrent.toExponential(6)}\n`;
    }
    return cards;
  },
};
