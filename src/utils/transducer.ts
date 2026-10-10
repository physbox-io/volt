import { inductorIc, type SimState } from './simState';

/**
 * One electromechanical primitive: any coil-and-field device as a set of
 * phases on one shaft.
 *
 * Each phase is R + L + a back-EMF source between two pins. A coupling
 * k_p(x) of the shaft position sets both the back-EMF, e_p = k_p(x)·ẋ, and the
 * torque the phase makes, k_p(x)·i_p — so electrical power in, Σ e_p·i_p, is
 * exactly mechanical power out, ẋ·Σ k_p·i_p, and no device built on this can
 * make or lose energy in the coupling.
 *
 * Couplings are data, not expressions: a constant plus cosines and sines of
 * the position. A DC motor is one phase with k = Kt; a two-phase hybrid
 * stepper two, with k = −Kt·sin(N·x) and Kt·cos(N·x). The same description
 * writes the back-EMF into the netlist and, when the shaft is a Mesh joint,
 * the force law Mesh applies — so the two cannot disagree.
 *
 * Unlinked, the shaft is simulated here: an electrical analog in which a
 * node's voltage is ẋ (rad/s) across a capacitor of J, friction is a
 * conductance of b, and the net torque is the current into it, with a second
 * node integrating ẋ into x when a coupling depends on it. Linked, the shaft
 * is Mesh's: its speed and angle are given, and nothing mechanical is
 * computed here at all.
 */

/** Σ cos·cos(w·x) + sin·sin(w·x); with w = 0, `cos` is a constant. */
export type Harmonic = { w: number; cos: number; sin: number };

export type TransducerPhase = {
  /** The handles of the pins the phase's coil sits between. */
  a: string;
  b: string;
  /** Winding resistance, Ω, and inductance, H. */
  r: number;
  l: number;
  /** k_p(x), in N·m/A (or N/A for a linear device). */
  k: Harmonic[];
};

export type ShaftModel = {
  /** Rotor inertia, kg·m² (or moving mass, kg). */
  j: number;
  /** Bearing friction, N·m·s/rad. */
  b: number;
  /** A constant torque against forward rotation, N·m: a hanging weight. Unlinked only. */
  load?: number;
  /** A torque pulling toward fixed positions with no current at all, e.g. a stepper's detent. Subtracted. */
  detent?: Harmonic[];
  /**
   * A linear spring back to x = 0, N·m/rad (or N/m): a loudspeaker's
   * suspension. Unlinked only. In the analog it is an inductor of 1/k from
   * the speed node to ground, whose current, ∫ẋ dt / (1/k) = k·x, is the
   * spring's force, so it needs no position node of its own.
   */
  stiffness?: number;
};

/** A whole device: what a part type is, independent of where it sits. */
export type TransducerSpec = { phases: TransducerPhase[]; shaft: ShaftModel };

/** The internal nodes of a transducer, for reading its shaft off a result. */
export const shaftNodes = (id: string) => ({
  /** Voltage = ẋ, rad/s. */
  speed: `int_${id}_w`,
  /** Voltage = x, rad. Present only when something depends on x. */
  position: `int_${id}_x`,
});

/** A shaft that is a Mesh joint, for one slice: where it is and how fast it turns. */
export type LinkedShaft = { x: number; w: number };

/** The element whose branch current is phase `index`'s current (1-based): its coil. */
export const phaseSense = (id: string, index: number) => `L_${id}_p${index}`;

const num = (v: number) => (Number.isFinite(v) ? String(v) : '0');

/** A coupling as a SPICE expression of the node holding x. */
export function harmonicExpr(terms: Harmonic[], x: string): string {
  const parts: string[] = [];
  for (const t of terms) {
    if (t.w === 0) {
      if (t.cos !== 0) parts.push(num(t.cos));
      continue;
    }
    if (t.cos !== 0) parts.push(`${num(t.cos)} * cos(${num(t.w)} * V(${x}))`);
    if (t.sin !== 0) parts.push(`${num(t.sin)} * sin(${num(t.w)} * V(${x}))`);
  }
  return parts.length > 0 ? parts.join(' + ') : '0';
}

const dependsOnPosition = (terms: Harmonic[] | undefined) => (terms ?? []).some(t => t.w !== 0);

/** Whether anything in the device depends on the shaft's position. */
export const usesPosition = (spec: TransducerSpec) =>
  spec.phases.some(p => dependsOnPosition(p.k)) || dependsOnPosition(spec.shaft.detent);

/**
 * The torque the device puts on its shaft for phase currents `currents`, as
 * a function of position: Σ i_p·k_p(x) less the detent, gathered by
 * wavenumber. What a linked Mesh joint is driven by.
 */
export function forceLaw(spec: TransducerSpec, currents: number[]): Harmonic[] {
  const byW = new Map<number, Harmonic>();
  const add = (t: Harmonic, scale: number) => {
    const h = byW.get(t.w) ?? { w: t.w, cos: 0, sin: 0 };
    h.cos += scale * t.cos;
    h.sin += scale * t.sin;
    byW.set(t.w, h);
  };
  spec.phases.forEach((p, i) => p.k.forEach(t => add(t, currents[i] ?? 0)));
  (spec.shaft.detent ?? []).forEach(t => add(t, -1));
  return [...byW.values()];
}

/**
 * The cards for one transducer. `net` names a pin's net by handle.
 *
 * Unlinked, the shaft's integrator is left out when nothing reads x: at a DC
 * operating point with the shaft turning it would sit at speed × its leak.
 */
export function emitTransducer(
  id: string,
  spec: TransducerSpec,
  net: (handle: string) => string,
  initialConditions: SimState | undefined,
  linked?: LinkedShaft,
): string {
  const { speed: w, position: x } = shaftNodes(id);
  const { phases, shaft } = spec;
  let cards = '';
  const torques: string[] = [];
  phases.forEach((p, i) => {
    const n = i + 1;
    const r = `int_${id}_p${n}r`;
    const l = `int_${id}_p${n}l`;
    const k = `(${harmonicExpr(p.k, x)})`;
    cards += `R_${id}_p${n} ${net(p.a)} ${r} ${num(Math.max(p.r, 1e-6))}\n`;
    // The coil's own branch current is the phase current the torque reads.
    cards += `L_${id}_p${n} ${r} ${l} ${num(Math.max(p.l, 1e-9))}${inductorIc(initialConditions, `L_${id}_p${n}`)}\n`;
    cards += `B_${id}_e${n} ${l} ${net(p.b)} V = ${k} * V(${w})\n`;
    torques.push(`${k} * I(${phaseSense(id, n)})`);
  });

  if (linked) {
    // Mesh's joint: speed held for the slice, angle running on at it.
    cards += `V_${id}_w ${w} 0 DC ${num(linked.w)}\n`;
    if (usesPosition(spec)) cards += `B_${id}_x ${x} 0 V = ${num(linked.x)} + ${num(linked.w)} * time\n`;
    return cards;
  }

  if (shaft.load) torques.push(`-(${num(shaft.load)})`);
  if (dependsOnPosition(shaft.detent)) torques.push(`-(${harmonicExpr(shaft.detent!, x)})`);

  cards += `C_${id}_j ${w} 0 ${num(Math.max(shaft.j, 1e-12))}\n`;
  // Friction, and with none a leak too slow to matter, so the node has a DC path.
  cards += `R_${id}_b ${w} 0 ${num(shaft.b > 0 ? 1 / shaft.b : 1e12)}\n`;
  cards += `B_${id}_t 0 ${w} I = ${torques.join(' + ')}\n`;
  if (shaft.stiffness && shaft.stiffness > 0) {
    cards += `L_${id}_k ${w} 0 ${num(1 / shaft.stiffness)}${inductorIc(initialConditions, `L_${id}_k`)}\n`;
  }
  if (usesPosition(spec)) {
    cards += `C_${id}_x ${x} 0 1\n`;
    cards += `R_${id}_xl ${x} 0 1e12\n`;
    cards += `B_${id}_x 0 ${x} I = V(${w})\n`;
  }
  return cards;
}
