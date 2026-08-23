import type { NodePropertiesProps } from './registry';
import { LeadHandles, RotatedSymbol, leadBoxStyle, resolveOrientation } from './schematic';

/**
 * A wire jumper: two pads bridged by a hand-fitted wire after milling.
 *
 * This is the escape hatch for a single-sided board. The router treats the two
 * pads as belonging to two *different* nets, so it never tries to run copper
 * between them — the connection is made by the physical wire instead. That is
 * exactly what the router means when it reports a net it could not route and
 * suggests a jumper.
 *
 * Electrically it is a wire, so unlike the other board-only parts it does reach
 * the netlist, as a near-zero resistance.
 */

/** Series resistance used to model the jumper wire in SPICE. */
export const JUMPER_RESISTANCE_OHMS = 0.001;

export function jumperDefaultData(label?: string) {
  return {
    label: label || 'Jumper',
    pitchMm: 5.08,
    drillDiameterMm: 0.8,
  };
}

export function JumperProperties({ node, updateData }: NodePropertiesProps) {
  const pitch = node.data?.pitchMm ?? 5.08;
  const drill = node.data?.drillDiameterMm ?? 0.8;
  const inputClass =
    'w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 ' +
    'text-slate-700 dark:text-slate-200 focus:border-blue-500 focus:outline-none';

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Pitch (mm)</label>
          <input
            type="number"
            step="0.01"
            min="1"
            value={pitch}
            onChange={e => updateData('pitchMm', parseFloat(e.target.value) || 5.08)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Drill (mm)</label>
          <input
            type="number"
            step="0.1"
            min="0.3"
            value={drill}
            onChange={e => updateData('drillDiameterMm', parseFloat(e.target.value) || 0.8)}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        The two pads are deliberately left unrouted — fit a wire between them after milling.
        Use one wherever the router reports a net it could not route on a single layer.
      </p>
    </>
  );
}

export function JumperNode({ data }: any) {
  const orientation = resolveOrientation(data?.orientation);

  return (
    <div className="schematic-node relative" style={leadBoxStyle(orientation, 44, 24)}>
      <LeadHandles
        first="a"
        second="b"
        orientation={orientation}
        className="w-3 h-3 bg-green-500"
      />
      <RotatedSymbol orientation={orientation} width={44} height={24}>
      <svg width="44" height="24" viewBox="0 0 44 24" style={{ overflow: 'visible' }}>
        {/* An arched wire between two pads — the shape it actually takes. */}
        <path
          d="M 6 14 Q 22 -2 38 14"
          fill="none"
          className="stroke-slate-600 dark:stroke-slate-200"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="6" cy="14" r="3.2" className="fill-amber-400 stroke-slate-600" strokeWidth="1.2" />
        <circle cx="38" cy="14" r="3.2" className="fill-amber-400 stroke-slate-600" strokeWidth="1.2" />
      </svg>
      </RotatedSymbol>
    </div>
  );
}
