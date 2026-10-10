import type { NodePropertiesProps } from './registry';
import { DC_MOTOR_DEFAULTS } from '../../utils/netlist/parts/dcmotor';
import { STEPPER_DEFAULTS } from '../../utils/netlist/parts/stepper';
import { STEP_DRIVER_DEFAULTS } from '../../utils/netlist/parts/stepdriver';
import { HBRIDGE_DEFAULTS } from '../../utils/netlist/parts/hbridge';
import { FUSE_DEFAULTS } from '../../utils/netlist/parts/fuse';
import { MESH_SIGNAL_DEFAULTS } from '../../utils/netlist/parts/meshsignal';
import { useMeshLinkInfo } from '../meshLinkContext';

type Field = { key: string; label: string; unit: string; fallback: number };

const f = (key: string, label: string, unit: string, fallback: number): Field => ({ key, label, unit, fallback });

/** The settings each part shows, with the value it simulates at when left blank. */
const FIELDS: Record<string, Field[]> = {
  dcmotor: [
    f('windingR', 'Winding resistance', 'Ω', DC_MOTOR_DEFAULTS.windingR),
    f('windingL', 'Winding inductance', 'H', DC_MOTOR_DEFAULTS.windingL),
    f('kt', 'Torque constant', 'N·m/A', DC_MOTOR_DEFAULTS.kt),
    f('inertia', 'Rotor inertia', 'kg·m²', DC_MOTOR_DEFAULTS.inertia),
    f('friction', 'Friction', 'N·m·s/rad', DC_MOTOR_DEFAULTS.friction),
    f('loadTorque', 'Load torque (at the output)', 'N·m', DC_MOTOR_DEFAULTS.loadTorque),
    f('gearRatio', 'Gear ratio (motor turns per output turn)', '', DC_MOTOR_DEFAULTS.gearRatio),
  ],
  stepper: [
    f('holdingTorque', 'Holding torque', 'N·m', STEPPER_DEFAULTS.holdingTorque),
    f('ratedCurrent', 'Rated current', 'A', STEPPER_DEFAULTS.ratedCurrent),
    f('windingR', 'Phase resistance', 'Ω', STEPPER_DEFAULTS.windingR),
    f('windingL', 'Phase inductance', 'H', STEPPER_DEFAULTS.windingL),
    f('detentTorque', 'Detent torque', 'N·m', STEPPER_DEFAULTS.detentTorque),
    f('rotorTeeth', 'Rotor teeth', '', STEPPER_DEFAULTS.rotorTeeth),
    f('inertia', 'Rotor inertia', 'kg·m²', STEPPER_DEFAULTS.inertia),
    f('friction', 'Friction', 'N·m·s/rad', STEPPER_DEFAULTS.friction),
    f('loadTorque', 'Load torque', 'N·m', STEPPER_DEFAULTS.loadTorque),
  ],
  stepdriver: [
    f('currentLimit', 'Current limit (peak)', 'A', STEP_DRIVER_DEFAULTS.currentLimit),
  ],
  hbridge: [
    f('rdsOn', 'Switch resistance', 'Ω', HBRIDGE_DEFAULTS.rdsOn),
  ],
  meshsignal: [
    f('gain', 'Gain', 'V per unit', MESH_SIGNAL_DEFAULTS.gain),
    f('offset', 'Offset', 'V', MESH_SIGNAL_DEFAULTS.offset),
    f('threshold', 'Switch at (blank: no switching)', '', NaN),
    f('hysteresis', 'Hysteresis band', '', MESH_SIGNAL_DEFAULTS.hysteresis),
    f('high', 'Output when on', 'V', MESH_SIGNAL_DEFAULTS.high),
    f('low', 'Output when off', 'V', MESH_SIGNAL_DEFAULTS.low),
  ],
  fuse: [
    f('rating', 'Rating', 'A', FUSE_DEFAULTS.rating),
    f('i2t', 'Melting I²t', 'A²s', FUSE_DEFAULTS.i2t),
    f('coldR', 'Resistance', 'Ω', FUSE_DEFAULTS.coldR),
  ],
};

export const INPUT =
  'w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 ' +
  'text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none';

/**
 * Settings for the electromechanical parts. Values are kept as typed, SI
 * suffixes and all ("2.8m"), and read with `numParam` when the netlist is built.
 */
/**
 * A picker over the linked Mesh scene's channels. The current value stays on
 * the list when the scene has no such channel (or nothing is linked), so a
 * binding saved with the circuit is not lost by opening it unlinked.
 */
export function ChannelPicker({ label, value, options, onChange, hint }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string | undefined) => void; hint: string;
}) {
  const known = options.some(o => o.value === value);
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value || undefined)} className={INPUT}>
        <option value="">Not bound</option>
        {value && !known && <option value={value}>{value} (not in the linked scene)</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="text-[10px] text-gray-400 mt-1">{hint}</div>
    </div>
  );
}

export function ElectromechProperties({ node, updateData }: NodePropertiesProps) {
  const fields = FIELDS[node.type ?? ''] ?? [];
  const data = node.data as Record<string, unknown>;
  const mesh = useMeshLinkInfo();
  const linkHint = mesh.status === 'linked'
    ? `From ${mesh.scene || 'the linked Mesh scene'}.`
    : 'Link Mesh (in the toolbar) to list its scene.';
  const joints = mesh.channels
    .filter(c => c.direction === 'input' && c.name.startsWith('joint:') && c.name.endsWith('.force'))
    .map(c => c.name.slice('joint:'.length, -'.force'.length))
    .map(j => ({ value: j, label: j }));
  const outputs = mesh.channels
    .filter(c => c.direction === 'output')
    .map(c => ({ value: c.name, label: `${c.description} (${c.unit})` }));
  return (
    <>
      {(node.type === 'dcmotor' || node.type === 'stepper') && (
        <ChannelPicker
          label="Shaft drives Mesh joint"
          value={typeof data.shaftJoint === 'string' ? data.shaftJoint : ''}
          options={joints}
          onChange={v => updateData('shaftJoint', v)}
          hint={`${linkHint} Bound, the motor turns the joint: Mesh does the mechanics, the circuit the electrics.`}
        />
      )}
      {node.type === 'meshsignal' && (
        <ChannelPicker
          label="Reads"
          value={typeof data.channel === 'string' ? data.channel : ''}
          options={outputs}
          onChange={v => updateData('channel', v)}
          hint={`${linkHint} A joint angle makes a pot, a speed a tachometer, a contact count with a threshold a limit switch.`}
        />
      )}
      {node.type === 'stepdriver' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Microstepping</label>
          <select
            value={String(data.microsteps ?? STEP_DRIVER_DEFAULTS.microsteps)}
            onChange={e => updateData('microsteps', Number(e.target.value))}
            className={INPUT}
          >
            {[1, 2, 4, 8, 16].map(m => <option key={m} value={m}>{m === 1 ? 'Full step' : `1/${m} step`}</option>)}
          </select>
        </div>
      )}
      {fields.map(field => (
        <div className="mb-3" key={field.key}>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            {field.label}{field.unit && <span className="text-gray-400"> ({field.unit})</span>}
          </label>
          <input
            type="text"
            value={data[field.key] === undefined ? '' : String(data[field.key])}
            placeholder={Number.isNaN(field.fallback) ? '' : String(field.fallback)}
            onChange={e => updateData(field.key, e.target.value.trim() === '' ? undefined : e.target.value)}
            className={INPUT}
          />
        </div>
      ))}
      {node.type === 'fuse' && data.blown && (
        <div className="text-[11px] text-red-600">Blown. Reset the simulation to fit a new one.</div>
      )}
    </>
  );
}
