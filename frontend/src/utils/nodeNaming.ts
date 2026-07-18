/** Derives a display name (R1, C2, L3, ...) for a passive component from its node id, unless the user has set a custom `data.name`. */
export function getNodeDefaultName(id: string, type: string): string {
  const match = id.match(/^(resistor|capacitor|inductor)-(\d+)$/i);
  if (match) {
    const prefix = type === 'resistor' ? 'R' : (type === 'capacitor' ? 'C' : 'L');
    return `${prefix}${match[2]}`;
  }
  if (/^[rcl]\d+$/i.test(id)) {
    return id.toUpperCase();
  }
  return id;
}
