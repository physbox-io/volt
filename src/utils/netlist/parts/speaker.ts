import type { Node } from '@xyflow/react';
import type { PartEmitter } from '../part';
import { numParam } from '../params';
import { emitTransducer, shaftNodes, type TransducerSpec } from '../../transducer';

/**
 * Air at room temperature, as Thiele and Small tabulated it: ρ in kg/m³ and
 * c in m/s. ρc² is the bulk modulus that makes a closed volume a spring.
 */
export const AIR = { rho: 1.18, c: 345 };

/** What the SPL node is scaled to: 0dB is 20µPa, so the node's magnitude in dB is SPL. */
export const SPL_REFERENCE_PA = 2e-5;
/** The distance the SPL node reads at, on axis: the 1m of a datasheet's sensitivity. */
export const SPL_DISTANCE_M = 1;

/**
 * A 3" full-range driver in the 8Ω class, in Thiele-Small terms (SI units).
 * fs = 1/(2π√(Mms·Cms)) ≈ 92Hz, Vas = ρc²·Sd²·Cms ≈ 1.5L, Qts ≈ 0.64.
 * The box is a litre, ported with a 1cm-radius, 5cm tube: fb ≈ 120Hz.
 */
export const SPEAKER_DEFAULTS = {
  /** Voice-coil resistance, Ω. */
  re: 7.2,
  /** Voice-coil inductance, H. */
  le: 0.1e-3,
  /** Force factor, T·m (= N/A = V·s/m). */
  bl: 4,
  /** Moving mass, air load included, kg. */
  mms: 3e-3,
  /** Suspension compliance, m/N. */
  cms: 1e-3,
  /** Mechanical resistance of the suspension, N·s/m. */
  rms: 0.5,
  /** Effective cone area, m². */
  sd: 3.3e-3,
  /** Internal box volume, m³. */
  boxVolume: 1e-3,
  /** Port tube length and radius, m. */
  portLength: 0.05,
  portRadius: 0.01,
  /**
   * How lossy a ported box is, as the Q of its leakage at the box's own
   * tuning: 7 is what Small found typical of a well-built one. Without some
   * loss the impedance minimum at fb falls to exactly Re and the response
   * below it to a perfect 24dB an octave, which no real box does.
   */
  boxLeakQ: 7,
};

export type SpeakerEnclosure = 'none' | 'sealed' | 'ported';

/** Whether this speaker is the Thiele-Small driver rather than the plain 8Ω load. */
export const usesDriverModel = (data: Record<string, unknown>) => data.driverModel === 'thiele-small';

export const speakerEnclosure = (data: Record<string, unknown>): SpeakerEnclosure =>
  data.enclosure === 'sealed' || data.enclosure === 'ported' ? data.enclosure : 'none';

type SpeakerParam = keyof typeof SPEAKER_DEFAULTS;
const param = (data: Record<string, unknown>, key: SpeakerParam) => numParam(data, key, SPEAKER_DEFAULTS[key]);

/** Box compliance, m⁵/N: Cab = Vb/(ρc²). */
export const boxCompliance = (vb: number) => vb / (AIR.rho * AIR.c * AIR.c);

/**
 * Port air mass, kg/m⁴: Map = ρ(Lp + 1.7·rp)/Sp. The 1.7·rp is the end
 * correction, the air either end of the tube that moves with it: 0.85·rp
 * for each end flanged into a baffle.
 */
export const portMass = (length: number, radius: number) =>
  (AIR.rho * (length + 1.7 * radius)) / (Math.PI * radius * radius);

/**
 * The driver as a transducer: one phase (the voice coil, Re + Le, coupled by
 * a constant Bl), and a linear "shaft" that is the cone — its voltage the
 * cone's velocity in m/s, Mms as the capacitor, 1/Rms the friction
 * conductance, and the suspension a spring of 1/Cms.
 */
export function speakerSpec(data: Record<string, unknown>): TransducerSpec {
  const p = (key: SpeakerParam) => param(data, key);
  return {
    phases: [{ a: 'in', b: 'gnd', r: p('re'), l: p('le'), k: [{ w: 0, cos: p('bl'), sin: 0 }] }],
    shaft: { j: p('mms'), b: p('rms'), stiffness: 1 / Math.max(p('cms'), 1e-12) },
  };
}

/** The internal nodes of a driver, for reading it off a result. */
export const speakerNodes = (id: string) => ({
  /** Voltage = cone velocity, m/s, positive into the box. */
  velocity: shaftNodes(id).speed,
  /** Voltage = the box's acoustic pressure, Pa. Present with an enclosure. */
  boxPressure: `int_${id}_pb`,
  /**
   * Voltage = the on-axis pressure at 1m over 20µPa, so that in an AC sweep
   * its magnitude in dB is the SPL. Present with the driver model.
   */
  spl: `int_${id}_spl`,
});

/** The element whose current is the port's volume velocity, m³/s, out of the box. */
export const portSense = (id: string) => `L_${id}_ap`;

const num = (v: number) => (Number.isFinite(v) ? String(v) : '0');

/**
 * The acoustic side, as an analog of its own: the box's pressure is a node's
 * voltage and volume velocity is current. The cone pushes Sd·v into the box;
 * the box is a capacitor of Cab; a port is an inductor of Map to the open
 * air, which is ground. The box pushes back on the cone with Sd·p, taken out
 * of the cone's velocity node, so the power the cone puts into the air,
 * Sd·p·v, is exactly what the acoustic side receives.
 *
 * Sealed, this is the Sd²/Cab of extra stiffness the plan names, written as
 * the box rather than folded into the suspension so the box pressure is
 * there to read. Free air has no box: the cone's own mass and suspension.
 *
 * The SPL is the far-field pressure of a small source in a half-space (an
 * infinite baffle): p = ρ·|dU/dt|/(2πr), U being everything that moves air
 * outward — the cone's front, less what goes into the box, plus the port.
 * dU/dt comes from a 1F capacitor fed U, whose current is the derivative.
 * Radiation impedance is not modelled beyond what Mms already includes, and
 * a driver in free air would in truth lose its bass to the back wave; the
 * SPL node is what it would make in a baffle.
 */
function emitAcoustics(node: Node, enclosure: SpeakerEnclosure): string {
  const id = node.id;
  const data = node.data as Record<string, unknown>;
  const { velocity: w, boxPressure: pb, spl } = speakerNodes(id);
  const sd = param(data, 'sd');
  let cards = '';
  let outward = `-${num(sd)} * V(${w})`;
  if (enclosure !== 'none') {
    const cab = boxCompliance(Math.max(param(data, 'boxVolume'), 1e-9));
    cards += `B_${id}_q 0 ${pb} I = ${num(sd)} * V(${w})\n`;
    cards += `B_${id}_f ${w} 0 I = ${num(sd)} * V(${pb})\n`;
    cards += `C_${id}_ab ${pb} 0 ${num(cab)}\n`;
    if (enclosure === 'ported') {
      const map = portMass(Math.max(param(data, 'portLength'), 0), Math.max(param(data, 'portRadius'), 1e-6));
      cards += `${portSense(id)} ${pb} 0 ${num(map)}\n`;
      // Leakage in parallel with the box, set so its Q at the tuning is QL:
      // R = QL·√(Map/Cab).
      const ql = Math.max(param(data, 'boxLeakQ'), 1e-3);
      cards += `R_${id}_al ${pb} 0 ${num(ql * Math.sqrt(map / cab))}\n`;
      outward = `I(${portSense(id)}) ${outward}`;
    } else {
      // A leak with a one-second time constant: a DC path for the box node,
      // and nothing anywhere in the audio band.
      cards += `R_${id}_al ${pb} 0 ${num(1 / cab)}\n`;
    }
  }
  cards += `B_${id}_u int_${id}_u 0 V = ${outward}\n`;
  cards += `V_${id}_du int_${id}_u int_${id}_ud DC 0\n`;
  cards += `C_${id}_du int_${id}_ud 0 1\n`;
  const gain = AIR.rho / (2 * Math.PI * SPL_DISTANCE_M * SPL_REFERENCE_PA);
  cards += `B_${id}_spl ${spl} 0 V = ${num(gain)} * I(V_${id}_du)\n`;
  return cards;
}

export const speaker: PartEmitter = {
  emit: (node, { net, initialConditions }) => {
    const data = node.data as Record<string, unknown>;
    // The plain load stays the default, byte for byte, so every circuit made
    // before the driver model existed sounds and solves exactly as it did.
    if (!usesDriverModel(data)) return `R_${node.id} ${net('in')} ${net('gnd')} 8\n`; // 8 ohm speaker load
    return emitTransducer(node.id, speakerSpec(data), net, initialConditions) + emitAcoustics(node, speakerEnclosure(data));
  },
  audio: () => true,
};
