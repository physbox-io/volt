import type { EmitContext, PartEmitter } from '../part';
import { numParam } from '../params';
import { logicHigh } from '../logic';
import { levelAt, type LogicTrace } from '../knownLogic';
import { pwlSource } from '../values';

/** Volts of bridge drive per amp of current error. */
const REGULATOR_GAIN = 300;

export const STEP_DRIVER_DEFAULTS = {
  /** Microsteps per full step: 1, 2, 4, 8 or 16. */
  microsteps: 16,
  /** Peak phase current, A: what the trimmer sets. */
  currentLimit: 1,
};

/**
 * Which model of the driver to simulate. 'detailed' counts STEP edges and
 * regulates each phase in the circuit; 'light' is told its edges and drives
 * each phase straight to its target; 'auto' (the default) is light in a run
 * that must keep up with real time, detailed otherwise.
 */
export type DriverModel = 'auto' | 'light' | 'detailed';

/** How long a light driver takes to move a phase to its next target, s: a chopper's typical response. */
const LIGHT_RAMP_S = 20e-6;

/** The node whose voltage is a step driver's electrical angle, rad, less the 45° it starts at. */
export const stepAngleNode = (id: string) => `int_${id}_th`;

/**
 * The light model: the edges are known, so the angle, and with it both phase
 * targets, are worked out before the solve as stepped waveforms, and each
 * phase is a current source following its target, ramped over a chopper's
 * response time.
 *
 * What it gives up is the regulator: a phase gets its target current whatever
 * voltage that takes, so past the speed where back-EMF eats the supply it
 * overstates torque, and the chopping itself is not seen. Each solve costs a
 * small fraction of the detailed model's — what lets a stepper run in real
 * time against Mesh or a board.
 */
function emitLight(
  id: string,
  nets: Record<'vm' | 'gnd' | 'a1' | 'a2' | 'b1' | 'b2', string>,
  traces: { step: LogicTrace; dir: LogicTrace; en: LogicTrace },
  delta: number,
  ilim: number,
  ctx: EmitContext,
): string {
  const { vm, gnd, a1, a2, b1, b2 } = nets;
  const th = stepAngleNode(id);
  const theta0 = ctx.initialConditions?.[th.toLowerCase()] ?? 0;
  // STEP's level as the last slice ended: a rise exactly on the boundary
  // shows only as this slice starting high.
  const stepWas = `int_${id}_sl`;
  const prevStep = ctx.initialConditions?.[stepWas.toLowerCase()];
  const roseAtStart = prevStep !== undefined && prevStep < 0.5 && traces.step.initial;

  // Every moment the target changes: a rising STEP edge, or EN changing.
  const events = [
    ...(roseAtStart ? [{ t: 0, kind: 'step' as const }] : []),
    ...traces.step.edges.filter(e => e.high).map(e => ({ t: e.t, kind: 'step' as const })),
    ...traces.en.edges.map(e => ({ t: e.t, kind: 'en' as const })),
  ].sort((a, b) => a.t - b.t);

  type Level = { theta: number; amp: number };
  const amp = (enHigh: boolean) => (enHigh ? 0 : ilim);
  let level: Level = { theta: theta0, amp: amp(traces.en.initial) };
  const levels: { t: number; level: Level }[] = [{ t: 0, level }];
  for (const ev of events) {
    level = ev.kind === 'step'
      ? { ...level, theta: level.theta + delta * (levelAt(traces.dir, ev.t) ? 1 : -1) }
      : { ...level, amp: amp(levelAt(traces.en, ev.t)) };
    levels.push({ t: ev.t, level });
  }

  // As a PWL: hold each level, ramp to the next over the chopper's response.
  const pwl = (value: (l: Level) => number) => {
    const pts = [{ t: 0, v: value(levels[0].level) }];
    for (let i = 1; i < levels.length; i++) {
      const { t, level: l } = levels[i];
      const next = levels[i + 1]?.t ?? Infinity;
      const ramp = Math.min(LIGHT_RAMP_S, (next - t) / 2);
      const prev = pts[pts.length - 1];
      if (t > prev.t) pts.push({ t, v: prev.v });
      pts.push({ t: t + ramp, v: value(l) });
    }
    return pts;
  };
  const ta = `int_${id}_ta`;
  const tb = `int_${id}_tb`;
  const ms = `int_${id}_ms`;
  const dirEnd = levelAt(traces.dir, ctx.length) ? 1 : -1;
  const phase = (name: string, p1: string, p2: string, target: string) => {
    const drv = `int_${id}_d${name}`;
    return `B_${id}_i${name} ${p2} ${drv} I = V(${target})\n`
      + `V_${id}_s${name} ${drv} ${p1} DC 0\n`
      // The bridge's outputs are referred to its rails, so the coil loop is not floating.
      + `R_${id}_r${name} ${p2} ${gnd} 1meg\n`;
  };
  const vs = `V(${vm}, ${gnd})`;
  return pwlSource(`V_${id}_th ${th} 0`, pwl(l => l.theta), 15)
    + `V_${id}_sl ${stepWas} 0 DC ${levelAt(traces.step, ctx.length) ? 1 : 0}\n`
    // Where a detailed driver's master stage would stand, so a run can switch models and keep counting.
    + `V_${id}_ms ${ms} 0 DC ${(level.theta + delta * dirEnd).toPrecision(16)}\n`
    + pwlSource(`V_${id}_ta ${ta} 0`, pwl(l => l.amp * Math.cos(l.theta + Math.PI / 4)))
    + pwlSource(`V_${id}_tb ${tb} 0`, pwl(l => l.amp * Math.sin(l.theta + Math.PI / 4)))
    + phase('a', a1, a2, ta)
    + phase('b', b1, b2, tb)
    + `B_${id}_sup ${vm} ${gnd} I = ${vs} > 0.5 ? (V(${a1}, ${a2}) * V(${ta}) + V(${b1}, ${b2}) * V(${tb})) / ${vs} : 0\n`;
}

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
  emit: (node, ctx) => {
    const { net } = ctx;
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

    const model = (node.data.driverModel as DriverModel | undefined) ?? 'auto';
    if (model === 'light' || (model === 'auto' && ctx.realtime)) {
      const traces = { step: ctx.logic('step'), dir: ctx.logic('dir'), en: ctx.logic('en') };
      if (traces.step && traces.dir && traces.en) {
        return emitLight(id, { vm, gnd, a1, a2, b1, b2 }, { step: traces.step, dir: traces.dir, en: traces.en }, delta, ilim, ctx);
      }
    }

    const th = stepAngleNode(id);
    const master = `int_${id}_ms`;
    // Each stage is shut outright once its switch is essentially off. The
    // logistic alone leaks ~1e-7 with STEP at rest, which outweighs the
    // hold resistor and leaves the operating point with no solution — θ
    // chasing its own next step — so a Run from rest started miscounted.
    const s = `int_${id}_sw`;
    const slaveOpen = `(V(${s}) > 1e-6 ? V(${s}) : 0)`;
    const masterOpen = `(V(${s}) < 0.999999 ? 1 - V(${s}) : 0)`;
    /*
     * The master aims at θ snapped toward the nearest whole step, plus one.
     * For the instant of an edge both halves are live and chase each other
     * up; aimed at θ itself that leaked 0.6% of a step on every pulse. The
     * snap θ − (Δ/2π)·sin(2πθ/Δ) is flat at every whole step, so the chase
     * cannot move it, and smooth, so the solver has no jump to fight — a
     * floor() did the same job but cost a gate-driven circuit 33s to find its
     * operating point, and non-overlapping thresholds stalled it outright.
     */
    const nearest = `(V(${th}) - ${delta / (2 * Math.PI)} * sin(${(2 * Math.PI) / delta} * V(${th})))`;
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

    return `B_${id}_sw ${s} 0 V = ${logicHigh(step, gnd)}\n`
      + `C_${id}_ms ${master} 0 1\n`
      + `R_${id}_ms ${master} 0 1e12\n`
      + `B_${id}_ms 0 ${master} I = ${follow} * (${nearest} + ${delta} * ${fwd} - V(${master})) * ${masterOpen}\n`
      + `C_${id}_th ${th} 0 1\n`
      + `R_${id}_th ${th} 0 1e12\n`
      + `B_${id}_th 0 ${th} I = ${follow} * (V(${master}) - V(${th})) * ${slaveOpen}\n`
      + phase('a', a1, a2, `${ilim} * ${enabled} * cos(${angle})`)
      + phase('b', b1, b2, `${ilim} * ${enabled} * sin(${angle})`)
      + `B_${id}_sup ${vm} ${gnd} I = ${vs} > 0.5 ? (V(int_${id}_ua) * I(V_${id}_sa) + V(int_${id}_ub) * I(V_${id}_sb)) / ${vs} : 0\n`;
  },
};
