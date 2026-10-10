import { useEffect, useState } from 'react';
import type { NodePropertiesProps } from './registry';
import { ChannelPicker, INPUT } from './ElectromechProperties';
import { useMeshLinkInfo } from '../meshLinkContext';
import { numParam } from '../../utils/netlist/params';
import {
  AIR, SPEAKER_DEFAULTS, boxCompliance, portMass, speakerEnclosure, usesDriverModel,
} from '../../utils/netlist/parts/speaker';
import { CAVITY_BINDINGS, CAVITY_EVENT, storedCavity, type MeshCavity } from '../../utils/meshCavity';

type Field = { key: keyof typeof SPEAKER_DEFAULTS; label: string; unit: string };

const DRIVER_FIELDS: Field[] = [
  { key: 're', label: 'Voice-coil resistance Re', unit: 'Ω' },
  { key: 'le', label: 'Voice-coil inductance Le', unit: 'H' },
  { key: 'bl', label: 'Force factor Bl', unit: 'T·m' },
  { key: 'mms', label: 'Moving mass Mms', unit: 'kg' },
  { key: 'cms', label: 'Suspension compliance Cms', unit: 'm/N' },
  { key: 'rms', label: 'Mechanical resistance Rms', unit: 'N·s/m' },
  { key: 'sd', label: 'Cone area Sd', unit: 'm²' },
];

const LABELS: Record<string, string> = {
  boxVolume: 'Box volume Vb',
  portLength: 'Port length',
  portRadius: 'Port radius',
};
const UNITS: Record<string, string> = { boxVolume: 'm³', portLength: 'm', portRadius: 'm' };

const fmt = (v: number, digits = 3) => (Number.isFinite(v) ? Number(v.toPrecision(digits)).toString() : '—');

function TextField({ data, k, label, unit, updateData }: {
  data: Record<string, unknown>; k: keyof typeof SPEAKER_DEFAULTS; label: string; unit: string; updateData: (key: string, v: unknown) => void;
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 dark:text-slate-400 mb-1">
        {label}<span className="text-gray-400"> ({unit})</span>
      </label>
      <input
        type="text"
        value={data[k] === undefined ? '' : String(data[k])}
        placeholder={String(SPEAKER_DEFAULTS[k])}
        onChange={e => updateData(k, e.target.value.trim() === '' ? undefined : e.target.value)}
        className={INPUT}
      />
    </div>
  );
}

/**
 * The opt-in Thiele-Small driver. Off, the speaker is the 8Ω resistor it has
 * always been. On, it is the driver's parameters, an enclosure, and the
 * figures they make (fs, Qts, Vas, and the box's fc or fb), with the box's
 * size bindable to a cavity measured in a linked Mesh scene, or applied from
 * one Mesh handed over unlinked.
 */
export function SpeakerDriverProperties({ node, updateData }: NodePropertiesProps) {
  const data = node.data as Record<string, unknown>;
  const mesh = useMeshLinkInfo();
  const on = usesDriverModel(data);
  const enclosure = speakerEnclosure(data);
  const [handoff, setHandoff] = useState<MeshCavity | null>(() => storedCavity());
  const [readError, setReadError] = useState('');

  useEffect(() => {
    const refresh = () => setHandoff(storedCavity());
    window.addEventListener(CAVITY_EVENT, refresh);
    return () => window.removeEventListener(CAVITY_EVENT, refresh);
  }, []);

  const bound = CAVITY_BINDINGS
    .map(b => ({ ...b, channel: typeof data[b.channelKey] === 'string' ? (data[b.channelKey] as string) : '' }))
    .filter(b => b.channel);
  const boundKey = bound.map(b => b.channel).join('|');

  /** Takes each bound setting's value from the scene; resolves to what went wrong, or ''. */
  const takeBound = async (bindings: { param: string; channel: string }[]): Promise<string> => {
    if (mesh.status !== 'linked' || bindings.length === 0) return '';
    try {
      const values = await mesh.read(bindings.map(b => b.channel));
      for (const b of bindings) if (values[b.channel] !== undefined) updateData(b.param, values[b.channel]);
      const missing = bindings.filter(b => values[b.channel] === undefined).map(b => b.channel);
      return missing.length ? `The scene has no ${missing.join(', ')}. Measure the cavity in Mesh first.` : '';
    } catch (e) {
      return String((e as Error)?.message || e);
    }
  };
  const readBound = (bindings: { param: string; channel: string }[]) => { void takeBound(bindings).then(setReadError); };

  // Linking (or re-linking) reads every bound setting afresh.
  useEffect(() => {
    if (mesh.status === 'linked') void takeBound(bound).then(setReadError);
    // Only on a change of link or of what is bound; `takeBound` is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh.status, boundKey]);

  const p = (key: keyof typeof SPEAKER_DEFAULTS) => numParam(data, key, SPEAKER_DEFAULTS[key]);
  const fs = 1 / (2 * Math.PI * Math.sqrt(p('mms') * p('cms')));
  const qms = (2 * Math.PI * fs * p('mms')) / p('rms');
  const qes = (2 * Math.PI * fs * p('mms') * p('re')) / (p('bl') * p('bl'));
  const qts = (qms * qes) / (qms + qes);
  const vas = AIR.rho * AIR.c * AIR.c * p('sd') * p('sd') * p('cms');
  const fc = fs * Math.sqrt(1 + vas / p('boxVolume'));
  const fb = 1 / (2 * Math.PI * Math.sqrt(portMass(p('portLength'), p('portRadius')) * boxCompliance(p('boxVolume'))));

  const linkHint = mesh.status === 'linked'
    ? `From ${mesh.scene || 'the linked Mesh scene'}.`
    : 'Link Mesh (in the toolbar) to list its measured cavities.';
  const optionsFor = (suffix: string) => mesh.channels
    .filter(c => c.direction === 'output' && c.name.endsWith(suffix))
    .map(c => ({ value: c.name, label: `${c.description} (${c.unit})` }));

  const applyHandoff = (c: MeshCavity) => {
    updateData('driverModel', 'thiele-small');
    updateData('enclosure', c.portLength !== undefined ? 'ported' : 'sealed');
    updateData('boxVolume', c.cavityVolume);
    if (c.portLength !== undefined) {
      updateData('portLength', c.portLength);
      updateData('portRadius', c.portRadius);
    }
  };

  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Driver model</label>
        <select
          value={on ? 'thiele-small' : 'resistor'}
          onChange={e => updateData('driverModel', e.target.value === 'thiele-small' ? 'thiele-small' : undefined)}
          className={INPUT}
        >
          <option value="resistor">8Ω resistor</option>
          <option value="thiele-small">Thiele-Small driver</option>
        </select>
        <div className="text-[10px] text-gray-400 mt-1">
          {on
            ? 'Voice coil, cone and box. In an AC sweep, the SPL node (int_<id>_spl) reads dB SPL at 1m on axis in a baffle.'
            : 'A plain 8Ω load, as the speaker has always been.'}
        </div>
      </div>

      {handoff && (
        <div className="mb-3 rounded border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-2 text-[11px] text-slate-700 dark:text-slate-300">
          <div className="mb-1">
            Measured in Mesh{handoff.scene ? ` (${handoff.scene})` : ''}: <b>{handoff.body}</b>, {fmt(handoff.cavityVolume * 1000)}L
            {handoff.portLength !== undefined && handoff.portRadius !== undefined
              && `, port ${fmt(handoff.portLength * 100)}cm long, ${fmt(handoff.portRadius * 100)}cm radius`}.
          </div>
          <button
            type="button"
            onClick={() => applyHandoff(handoff)}
            className="rounded border border-emerald-500 px-2 py-0.5 text-[11px] hover:bg-emerald-100 dark:hover:bg-emerald-900"
          >
            Use for this speaker
          </button>
        </div>
      )}

      {on && (
        <>
          {DRIVER_FIELDS.map(f => <TextField key={f.key} data={data} k={f.key} label={f.label} unit={f.unit} updateData={updateData} />)}
          <div className="mb-3 text-[10px] text-gray-500 dark:text-slate-400">
            fs {fmt(fs)}Hz · Qts {fmt(qts, 2)} · Vas {fmt(vas * 1000)}L
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 dark:text-slate-400 mb-1">Enclosure</label>
            <select value={enclosure} onChange={e => updateData('enclosure', e.target.value === 'none' ? undefined : e.target.value)} className={INPUT}>
              <option value="none">None (free air)</option>
              <option value="sealed">Sealed box</option>
              <option value="ported">Ported box</option>
            </select>
          </div>

          {enclosure !== 'none' && CAVITY_BINDINGS
            .filter(b => enclosure === 'ported' || b.param === 'boxVolume')
            .map(b => (
              <div key={b.param}>
                <TextField data={data} k={b.param} label={LABELS[b.param]} unit={UNITS[b.param]} updateData={updateData} />
                <ChannelPicker
                  label={`${LABELS[b.param]} from Mesh`}
                  value={typeof data[b.channelKey] === 'string' ? (data[b.channelKey] as string) : ''}
                  options={optionsFor(b.suffix)}
                  onChange={v => {
                    updateData(b.channelKey, v);
                    if (v) readBound([{ param: b.param, channel: v }]);
                  }}
                  hint={`${linkHint} Bound, the setting takes the measurement whenever Mesh is linked.`}
                />
              </div>
            ))}
          {enclosure === 'ported' && (
            <TextField data={data} k="boxLeakQ" label="Box leakage QL" unit="Q at fb" updateData={updateData} />
          )}
          {enclosure !== 'none' && (
            <div className="mb-3 text-[10px] text-gray-500 dark:text-slate-400">
              {enclosure === 'sealed' ? `fc ${fmt(fc)}Hz` : `fb ${fmt(fb)}Hz`}
              {bound.length > 0 && mesh.status === 'linked' && (
                <button type="button" onClick={() => readBound(bound)} className="ml-2 underline">Read Mesh again</button>
              )}
            </div>
          )}
          {readError && <div className="mb-3 text-[11px] text-red-600">{readError}</div>}
        </>
      )}
    </>
  );
}
