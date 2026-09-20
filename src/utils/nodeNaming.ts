// ---------------------------------------------------------------------------
// Reference designators
//
// A schematic is talked about by designator: "probe pin 3 of U1", "swap R2 for
// 10k". Only the three passives had one - everything else showed its value or
// its kind, so two 1N4148s on a board were both "1N4148" on the drawing and
// neither was findable against a footprint.
//
// The designator is derived, not stored: a part carries `data.name` only when
// someone has renamed it by hand. That keeps a circuit saved by an older build,
// or built by an agent, correctly designated without a migration.
// ---------------------------------------------------------------------------

/**
 * The letter each kind of part is numbered under, by the usual conventions
 * (IEEE 315): every transistor is a Q whatever its polarity, every diode and
 * LED a D, every IC a U.
 *
 * A type that is absent gets no designator, and there are three reasons for
 * that: it is not a part at all (ground, a junction, a net label, a rail), it
 * is test equipment rather than something on the board (the scope and the
 * multimeter), or it is a feature of the board rather than a part fitted to it
 * (a via, a cutout).
 */
export const DESIGNATOR_PREFIXES: Record<string, string> = {
  resistor: 'R',
  potentiometer: 'RV',
  ldr: 'R',
  capacitor: 'C',
  inductor: 'L',
  transformer: 'T',

  diode: 'D',
  zener: 'D',
  led: 'D',

  npn: 'Q',
  pnp: 'Q',
  nmos: 'Q',
  pmos: 'Q',

  // Every integrated circuit, the logic gates included: a gate on a schematic
  // is one gate of a package, and it is a U when it is fitted.
  timer555: 'U',
  opamp: 'U',
  dff: 'U',
  mcu: 'U',
  heltec_v4: 'U',
  and: 'U',
  or: 'U',
  not: 'U',
  nand: 'U',
  nor: 'U',
  xor: 'U',

  sevenseg: 'DS',
  speaker: 'LS',
  microphone: 'MK',
  switch: 'SW',

  // Sources share one sequence, as they do in every other EDA package: the
  // circuit has one V1, whether it is a battery or a generator.
  voltage: 'V',
  acvoltage: 'V',
  signalgen: 'V',
  currentsource: 'I',

  pinheader: 'J',
  jumper: 'JP',
  mountinghole: 'MH',
};

/** The letter this kind of part is numbered under, or null if it gets none. */
export function designatorPrefix(type: string | undefined): string | null {
  return (type && DESIGNATOR_PREFIXES[type]) || null;
}

/**
 * A display name for one part, knowing only its id and kind.
 *
 * This is the fallback for the callers that have no canvas to count against —
 * the id's own number is used, which is unique but not consecutive, so a
 * circuit of one resistor and one diode reads R1 and D2. `assignDesignators`
 * below is what the canvas actually shows; this keeps a symbol rendered outside
 * the provider (a preview, a test) from having no name at all.
 */
export function getNodeDefaultName(id: string, type: string): string {
  const prefix = designatorPrefix(type);
  if (prefix) {
    const match = id.match(/-(\d+)$/);
    if (match) return `${prefix}${match[1]}`;
    // Ids like `r1` and `C12`, which older saved circuits carry.
    const bare = id.match(/^[a-z]+(\d+)$/i);
    if (bare) return `${prefix}${bare[1]}`;
  }
  // Kept for the three passives that were named this way before every part
  // was: an id that already spells its own designator stays as it is.
  if (/^[rcl]\d+$/i.test(id)) return id.toUpperCase();
  return id;
}

type NamedNode = { id: string; type?: string; data?: { name?: unknown } | Record<string, unknown> };

/**
 * Every part's designator, numbered per letter across the whole canvas: R1, R2,
 * R3, and the diodes counting from D1 alongside them.
 *
 * Numbering follows the order parts were created (the number in the node id),
 * so a part added to a circuit takes the next number rather than renumbering
 * what is already drawn. A part renamed by hand keeps its name *and* reserves
 * its number, so hand-naming one part R7 does not leave a second R7 derived
 * beside it.
 */
export function assignDesignators(nodes: NamedNode[]): Record<string, string> {
  const ordered = [...nodes].sort((a, b) => creationOrder(a.id) - creationOrder(b.id) || (a.id < b.id ? -1 : 1));

  // Numbers already claimed by hand-named parts, per prefix.
  const taken: Record<string, Set<number>> = {};
  const claim = (prefix: string, n: number) => {
    (taken[prefix] ??= new Set()).add(n);
  };
  for (const node of ordered) {
    const name = (node.data as { name?: unknown } | undefined)?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    const match = name.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (match) claim(match[1], Number(match[2]));
  }

  const next: Record<string, number> = {};
  const out: Record<string, string> = {};

  for (const node of ordered) {
    const name = (node.data as { name?: unknown } | undefined)?.name;
    if (typeof name === 'string' && name.trim()) {
      out[node.id] = name.trim();
      continue;
    }
    const prefix = designatorPrefix(node.type);
    if (!prefix) continue;

    let n = next[prefix] ?? 1;
    while (taken[prefix]?.has(n)) n++;
    next[prefix] = n + 1;
    out[node.id] = `${prefix}${n}`;
  }

  return out;
}

/** The number in `resistor-12`, which is the order the part was created in. */
function creationOrder(id: string): number {
  const match = id.match(/-(\d+)$/) ?? id.match(/^[a-z]+(\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
