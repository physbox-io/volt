import { inductorIc, type SimState } from './simState';

/**
 * One electromechanical primitive: any coil-and-field device as a set of
 * phases on one shaft.
 *
 * Each phase is R + L + a back-EMF source between two pins. A coupling
 * function k_p(x) of the shaft position sets both the back-EMF,
 * e_p = k_p(x)·ẋ, and the torque the phase makes, k_p(x)·i_p — so electrical
 * power in, Σ e_p·i_p, is exactly mechanical power out, ẋ·Σ k_p·i_p, and no
 * device built on this can make or lose energy in the coupling.
 *
 * A DC motor is one phase with k = Kt; a two-phase hybrid stepper is two
 * phases with k = −Kt·sin(N·x) and Kt·cos(N·x). A linear device (solenoid,
 * voice coil) is the same with x a displacement, J a mass and torques forces.
 *
 * The shaft is internal: an electrical analog in which a node's voltage is ẋ
 * (rad/s) across a capacitor of J, friction is a conductance of b, and the
 * net torque is the current into it. A second node integrates ẋ into x when
 * any phase's coupling depends on it. Both are node voltages, so a sliced run
 * carries the shaft's speed and position the way it carries the circuit's.
 */

/** A SPICE expression of the shaft position, given the name of the node holding x. */
export type Coupling = (x: string) => string;

export type TransducerPhase = {
  /** The pins the phase's coil sits between. */
  a: string;
  b: string;
  /** Winding resistance, Ω, and inductance, H. */
  r: number;
  l: number;
  /** k_p(x), in N·m/A (or N/A for a linear device). */
  k: Coupling;
};

export type ShaftModel = {
  /** Moment of inertia, kg·m² (or mass, kg). */
  j: number;
  /** Viscous friction, N·m·s/rad. */
  b: number;
  /** A constant torque against forward rotation, N·m: a hanging weight. */
  load?: number;
  /** Torque toward x = 0 per radian, N·m/rad: a return spring. */
  spring?: number;
  /** A position-dependent torque not from the coils, e.g. a stepper's detent, as an expression of x. */
  detent?: Coupling;
};

/** The internal nodes of a transducer, for reading its shaft off a result. */
export const shaftNodes = (id: string) => ({
  /** Voltage = ẋ, rad/s. */
  speed: `int_${id}_w`,
  /** Voltage = x, rad. Present only when something depends on x. */
  position: `int_${id}_x`,
  /** Linked only: voltage = the torque the shaft makes, N·m, to hand to Mesh. */
  torque: `int_${id}_tq`,
});

/**
 * A shaft coupled to a Mesh joint for one slice.
 *
 * The shaft's dynamics stay here, where the solver can resolve them however
 * stiff they are (a stepper's rotor rings at a few hundred hertz), with the
 * joint's inertia added to the rotor's and the scene's load on the joint as a
 * constant torque. The slice starts from the joint's speed and angle (carried
 * as initial conditions on the shaft nodes), and Mesh is handed the torque the
 * shaft transmits, so both ends integrate the same motion.
 */
export type LinkedShaft = {
  /** The joint's own inertia, kg·m² (its mass-matrix diagonal). */
  inertia: number;
  /** The torque the rest of the scene puts on the joint, N·m. */
  load: number;
};

/** The element whose branch current is phase `index`'s current (1-based). */
export const phaseSense = (id: string, index: number) => `V_${id}_p${index}`;

const num = (v: number) => (Number.isFinite(v) ? String(v) : '0');

/**
 * The cards for one transducer with internal mechanics.
 *
 * `usesPosition` says whether anything reads x: without it the position
 * integrator is left out, since at a DC operating point with the shaft
 * turning it would sit at speed × its leak resistance.
 */
export function emitTransducer(
  id: string,
  phases: TransducerPhase[],
  shaft: ShaftModel,
  initialConditions: SimState | undefined,
  usesPosition: boolean,
  linked?: LinkedShaft,
): string {
  const { speed: w, position: x } = shaftNodes(id);
  let cards = '';
  const torques: string[] = [];
  phases.forEach((p, i) => {
    const n = i + 1;
    const r = `int_${id}_p${n}r`;
    const l = `int_${id}_p${n}l`;
    const e = `int_${id}_p${n}e`;
    const k = `(${p.k(x)})`;
    cards += `R_${id}_p${n} ${p.a} ${r} ${num(Math.max(p.r, 1e-6))}\n`;
    cards += `L_${id}_p${n} ${r} ${l} ${num(Math.max(p.l, 1e-9))}${inductorIc(initialConditions, `L_${id}_p${n}`)}\n`;
    // 0V, to read the phase current by, for the torque.
    cards += `${phaseSense(id, n)} ${l} ${e} DC 0\n`;
    cards += `B_${id}_e${n} ${e} ${p.b} V = ${k} * V(${w})\n`;
    torques.push(`${k} * I(${phaseSense(id, n)})`);
  });

  const springAndDetent: string[] = [];
  if (shaft.spring) springAndDetent.push(`-(${num(shaft.spring)}) * V(${x})`);
  if (shaft.detent) springAndDetent.push(`-(${shaft.detent(x)})`);


  if (linked) {
    // What the motor itself makes, less its bearing friction: the torque it
    // puts into the shaft, read back to work out what reaches the joint.
    const friction = shaft.b > 0 ? [`-(${num(shaft.b)}) * V(${w})`] : [];
    cards += `B_${id}_tq ${shaftNodes(id).torque} 0 V = ${[...torques, ...springAndDetent, ...friction].join(' + ')}\n`;
    // The scene's load replaces the part's own.
    torques.push(`${num(linked.load)}`);
  } else if (shaft.load) {
    torques.push(`-(${num(shaft.load)})`);
  }
  torques.push(...springAndDetent);

  const j = shaft.j + (linked ? Math.max(linked.inertia, 0) : 0);
  cards += `C_${id}_j ${w} 0 ${num(Math.max(j, 1e-12))}\n`;
  // Friction, and with none a leak too slow to matter, so the node has a DC path.
  cards += `R_${id}_b ${w} 0 ${num(shaft.b > 0 ? 1 / shaft.b : 1e12)}\n`;
  cards += `B_${id}_t 0 ${w} I = ${torques.join(' + ')}\n`;
  if (usesPosition || shaft.spring || shaft.detent) {
    cards += `C_${id}_x ${x} 0 1\n`;
    cards += `R_${id}_xl ${x} 0 1e12\n`;
    cards += `B_${id}_x 0 ${x} I = V(${w})\n`;
  }
  return cards;
}
