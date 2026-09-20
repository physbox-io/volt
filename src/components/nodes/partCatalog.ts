/**
 * Every part the palette offers, as data.
 *
 * The palette itself is hand-drawn SVG per part and stays that way — the
 * drawings are the point of it. What the quick-add launcher needs is the flat
 * list: a name to match what was typed against, the node type to drop, and the
 * seed label the palette would have dragged along with it. `tests/partCatalog`
 * holds the two lists together, so a part added to the sidebar and not to this
 * file fails the suite rather than going quietly missing from search.
 */
export interface CatalogPart {
  type: string;
  /** What the part is called in the launcher. */
  name: string;
  /** The seed label the palette drags with this entry, if any. */
  label?: string;
  /** Extra words that should find it — what it is called elsewhere. */
  keywords?: string;
  section: string;
}

export const PART_CATALOG: CatalogPart[] = [
  // Transistors
  { type: 'npn', name: 'NPN BJT', keywords: 'transistor bipolar 2n3904', section: 'Transistors' },
  { type: 'pnp', name: 'PNP BJT', keywords: 'transistor bipolar 2n3906', section: 'Transistors' },
  { type: 'nmos', name: 'NMOS', keywords: 'transistor mosfet fet n-channel', section: 'Transistors' },
  { type: 'pmos', name: 'PMOS', keywords: 'transistor mosfet fet p-channel', section: 'Transistors' },

  // Logic gates
  { type: 'and', name: 'AND Gate', keywords: 'logic', section: 'Logic Gates' },
  { type: 'or', name: 'OR Gate', keywords: 'logic', section: 'Logic Gates' },
  { type: 'not', name: 'NOT Gate', keywords: 'logic inverter', section: 'Logic Gates' },
  { type: 'nand', name: 'NAND Gate', keywords: 'logic', section: 'Logic Gates' },
  { type: 'nor', name: 'NOR Gate', keywords: 'logic', section: 'Logic Gates' },
  { type: 'xor', name: 'XOR Gate', keywords: 'logic exclusive', section: 'Logic Gates' },

  // Tools
  { type: 'voltage', name: 'DC Voltage', label: '5V', keywords: 'battery supply source vdc', section: 'Tools' },
  { type: 'ground', name: 'Ground', keywords: 'gnd 0v reference earth', section: 'Tools' },
  { type: 'resistor', name: 'Resistor', label: '1k', keywords: 'ohm r', section: 'Tools' },
  { type: 'capacitor', name: 'Capacitor', label: '10u', keywords: 'farad c cap', section: 'Tools' },
  { type: 'inductor', name: 'Inductor', label: '100u', keywords: 'henry coil l', section: 'Tools' },
  { type: 'diode', name: 'Diode', keywords: '1n4148 rectifier', section: 'Tools' },
  { type: 'led', name: 'LED', keywords: 'light lamp indicator', section: 'Tools' },
  { type: 'timer555', name: '555 Timer', keywords: 'ne555 oscillator astable', section: 'Tools' },
  { type: 'mcu', name: 'Microcontroller', keywords: 'mcu arduino javascript code', section: 'Tools' },
  { type: 'heltec_v4', name: 'Heltec V4', keywords: 'esp32 board hil hardware', section: 'Tools' },
  { type: 'opamp', name: 'Op-Amp', keywords: 'operational amplifier lm358', section: 'Tools' },
  { type: 'multimeter', name: 'Multimeter', keywords: 'dmm meter volts amps', section: 'Tools' },
  { type: 'acvoltage', name: 'AC Voltage', label: '10V 60Hz', keywords: 'mains sine source', section: 'Tools' },
  { type: 'signalgen', name: 'Signal Generator', keywords: 'function waveform square sine', section: 'Tools' },
  { type: 'scope', name: 'Oscilloscope', keywords: 'scope probe waveform', section: 'Tools' },
  { type: 'speaker', name: 'Speaker', keywords: 'audio output sound', section: 'Tools' },
  { type: 'microphone', name: 'Microphone', keywords: 'audio input mic sound', section: 'Tools' },
  { type: 'switch', name: 'Switch', keywords: 'button toggle spst', section: 'Tools' },
  { type: 'potentiometer', name: 'Potentiometer', label: '10k', keywords: 'pot variable resistor wiper', section: 'Tools' },
  { type: 'sevenseg', name: 'Seven Segment', keywords: '7 segment display digit', section: 'Tools' },
  { type: 'currentsource', name: 'Current Source', label: '10m', keywords: 'amps idc', section: 'Tools' },
  { type: 'transformer', name: 'Transformer', keywords: 'coupled coils primary secondary', section: 'Tools' },
  { type: 'dff', name: 'D Flip-Flop', keywords: 'latch register clock', section: 'Tools' },
  { type: 'ldr', name: 'LDR', keywords: 'photoresistor light sensor', section: 'Tools' },

  // Nets & power
  { type: 'netlabel', name: 'Net Label', label: 'Net', keywords: 'net name signal flag sda reset', section: 'Nets & Power' },
  { type: 'powerrail', name: '+5V Rail', label: '+5V', keywords: 'power supply vcc rail', section: 'Nets & Power' },
  { type: 'powerrail', name: '+3.3V Rail', label: '+3.3V', keywords: 'power supply rail 3v3', section: 'Nets & Power' },

  // PCB / mechanical
  { type: 'pinheader', name: 'Pin Header', label: 'Header', keywords: 'connector strip pads', section: 'PCB / Mechanical' },
  { type: 'via', name: 'Via', label: 'Via', keywords: 'through hole layer change', section: 'PCB / Mechanical' },
  { type: 'mountinghole', name: 'Mounting Hole', label: 'Mount', keywords: 'screw m3 standoff', section: 'PCB / Mechanical' },
  { type: 'jumper', name: 'Wire Jumper', label: 'Jumper', keywords: 'bridge link unrouted', section: 'PCB / Mechanical' },
  { type: 'cutout', name: 'Board Cutout', label: 'Cutout', keywords: 'slot window milling', section: 'PCB / Mechanical' },
];

/** A part's key in the launcher: the type alone is not unique (two rails). */
export function catalogKey(part: CatalogPart): string {
  return `${part.type}:${part.label ?? ''}`;
}

/**
 * Parts matching what has been typed, best first.
 *
 * Subsequence matching rather than substring, so `sg` finds the signal
 * generator and `55` the 555 — the point of typing into a launcher is not
 * having to know how a part is spelled. A match earlier in the name, and one
 * that is contiguous, sorts above a match scattered through it.
 */
export function searchParts(query: string, catalog: CatalogPart[] = PART_CATALOG): CatalogPart[] {
  const q = query.trim().toLowerCase();
  if (!q) return catalog;

  const scored: { part: CatalogPart; score: number; index: number }[] = [];
  catalog.forEach((part, index) => {
    const name = part.name.toLowerCase();
    const haystack = `${name} ${part.type} ${part.label ?? ''} ${part.keywords ?? ''}`.toLowerCase();

    let score: number;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (haystack.includes(q)) score = 2;
    else if (isSubsequence(q, name)) score = 3;
    else if (isSubsequence(q, haystack)) score = 4;
    else return;

    scored.push({ part, score, index });
  });

  scored.sort((a, b) => (a.score - b.score) || (a.index - b.index));
  return scored.map(s => s.part);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}
