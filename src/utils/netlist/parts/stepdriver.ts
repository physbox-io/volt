import type { PartEmitter } from '../part';
import { numParam } from '../params';
import { logicHigh } from '../logic';

/** Volts of bridge drive per amp of current error. */
const REGULATOR_GAIN = 300;

export const STEP_DRIVER_DEFAULTS = {
  /** Microsteps per full step: 1, 2, 4, 8 or 16. */
  microsteps: 16,
  /** Peak phase current, A: what the trimmer sets. */
  currentLimit: 1,
};

/** The node whose voltage is a step driver's electrical angle, rad, less the 45° it starts at. */
export const stepAngleNode = (id: string) => `int_${id}_th`;

/**
 * An A4988 / TMC2209-style stepper driver: STEP, DIR and EN in, two
 * regulated phase currents out.
 *
 * Each rising edge on STEP moves the electrical angle θ a microstep, forward
 * with DIR high. Phase A is driven to Ilim·cos θ and phase B to Ilim·sin θ,
 * from 45° — the A4988's home, where a full step has both phases at 71%. EN
 * is active low and, high, drives both currents to zero.
 *
 * The edge counter is a master-slave pair, like the flip-flop's: while STEP
 * is low the master settles on θ + one step, and when STEP goes high θ takes
 * it. It counts exactly, has no drift to accumulate, and both halves are node
 * voltages that a sliced run carries.
 *
 * The chopper is modelled by what it achieves, not how: each phase's bridge
 * voltage is whatever brings its current to the target, up to the supply. The
 * supply is drawn for the power the bridges deliver.
 */
export const stepdriver: PartEmitter = {
  emit: (node, { net }) => {
    const id = node.id;
    const vm = net('vm');
    const gnd = net('gnd');
    const step = net('step');
    const dir = net('dir');
    const en = net('en');
    const a1 = net('a1');
    const a2 = net('a2');
    const b1 = net('b1');
    const b2 = net('b2');
    const micro = Math.max(1, Math.round(numParam(node.data, 'microsteps', STEP_DRIVER_DEFAULTS.microsteps)));
    const ilim = Math.max(0, numParam(node.data, 'currentLimit', STEP_DRIVER_DEFAULTS.currentLimit));
    const delta = Math.PI / 2 / micro;

    const th = stepAngleNode(id);
    const master = `int_${id}_ms`;
    const s = logicHigh(step, gnd);
    const fwd = `(2 * ${logicHigh(dir, gnd)} - 1)`;
    const enabled = `(1 - ${logicHigh(en, gnd)})`;
    // Fast enough to settle inside a 1µs edge, slow enough for the solver.
    const follow = 1e6;
    const angle = `(V(${th}) + ${Math.PI / 4})`;
    const vs = `V(${vm}, ${gnd})`;

    const phase = (name: string, p1: string, p2: string, target: string) => {
      const sense = `V_${id}_s${name}`;
      const u = `int_${id}_u${name}`;
      const drv = `int_${id}_d${name}`;
      const want = `int_${id}_t${name}`;
      /*
       * Proportional, clamped to the supply. The gain is a trade: the current
       * settles R/(G+R) short of the target (0.5% for a 1.5Ω phase), and a
       * stiffer loop costs solve time — at 1000 a 5ms slice took half as long
       * again as at 300. The target sits on a node of its own so the clamp,
       * which reads it three times, does not evaluate it three times.
       */
      const err = `${REGULATOR_GAIN} * (V(${want}) - I(${sense}))`;
      return `B_${id}_t${name} ${want} 0 V = ${target}\n`
        + `B_${id}_u${name} ${u} 0 V = ${err} > ${vs} ? ${vs} : (${err} < -${vs} ? -${vs} : ${err})\n`
        + `B_${id}_${name}1 ${drv} ${gnd} V = (${vs} + V(${u})) / 2\n`
        + `${sense} ${drv} ${p1} DC 0\n`
        + `B_${id}_${name}2 ${p2} ${gnd} V = (${vs} - V(${u})) / 2\n`;
    };

    return `C_${id}_ms ${master} 0 1\n`
      + `R_${id}_ms ${master} 0 1e12\n`
      + `B_${id}_ms 0 ${master} I = ${follow} * (V(${th}) + ${delta} * ${fwd} - V(${master})) * (1 - ${s})\n`
      + `C_${id}_th ${th} 0 1\n`
      + `R_${id}_th ${th} 0 1e12\n`
      + `B_${id}_th 0 ${th} I = ${follow} * (V(${master}) - V(${th})) * ${s}\n`
      + phase('a', a1, a2, `${ilim} * ${enabled} * cos(${angle})`)
      + phase('b', b1, b2, `${ilim} * ${enabled} * sin(${angle})`)
      + `B_${id}_sup ${vm} ${gnd} I = ${vs} > 0.5 ? (V(int_${id}_ua) * I(V_${id}_sa) + V(int_${id}_ub) * I(V_${id}_sb)) / ${vs} : 0\n`;
  },
};
