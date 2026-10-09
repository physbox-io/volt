import type { PartEmitter } from '../part';

const GPIO = ['GPIO_1', 'GPIO_3', 'GPIO_33', 'GPIO_36', 'GPIO_37', 'GPIO_41'];

/**
 * A Heltec board in the loop. An input pin is a source at the voltage last
 * read off the real pin; an output pin is a light load the simulated net
 * drives, and what it is driven to is sent to the real pin.
 */
export const heltec: PartEmitter = {
  emit: (node, { net }) => {
    const pinModes = (node.data.pins || {}) as Record<string, string>;
    const pinVoltages = (node.data.pinVoltages || {}) as Record<string, unknown>;
    let cards = '';

    for (const pin of GPIO) {
      const pinNet = net(pin);
      const mode = pinModes[pin] || 'digital_in';

      if (mode === 'analog_in' || mode === 'digital_in') {
        const v = pinVoltages[pin] !== undefined ? Number(pinVoltages[pin]) : 0.0;
        cards += `V_heltec_${node.id}_${pin} ${pinNet} 0 DC ${v.toFixed(4)}\n`;
      } else if (mode === 'digital_out') {
        cards += `R_heltec_${node.id}_${pin} ${pinNet} 0 100k\n`;
      }
    }

    const vccNet = net('3V3');
    const gndNet = net('GND');
    cards += `V_heltec_${node.id}_3V3 ${vccNet} 0 DC 3.3\n`;
    cards += `R_heltec_${node.id}_GND ${gndNet} 0 1m\n`;
    return cards;
  },
};
