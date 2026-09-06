import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { DEVICE_CARD_DARK } from './schematic';
import {
  getEffectiveMcuConfig,
  createCustomMcuConfig,
  MCU_PRESETS,
  mcuPackageId,
  rightColumnRunsUp,
  type McuGeometryConfig,
  type McuPinDef,
  type McuPinSide,
  type McuPinType,
} from '../../utils/mcuConfig';
import { Plus, Trash2, Cpu, Wrench } from 'lucide-react';
import { NumberInput } from '../NumberInput';

/**
 * Reads the pad-number field. Kept as a number when it is one, so a part typed
 * in by hand matches the 1..N pads a generated footprint numbers, and as text
 * when it is a designator such as `J2-12`. Blank clears it, which puts the pin
 * back on its position in the list.
 */
function parsePinNumber(raw: string): number | string | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  return /^\d+$/.test(text) ? parseInt(text, 10) : text;
}

/**
 * Column widths, shared by the header strip and the pin rows below it. The
 * three names a pin carries are easy to mix up, so the list is headed rather
 * than left to tooltips — which means the two have to be laid out from the
 * same numbers or the headings drift off their fields.
 */
const PIN_COL = {
  // Two lines per pin: names on the first, placement on the second. One line
  // did fit, but only by abbreviating the dropdowns down to single letters.
  // `shrink-0` throughout, so a long label cannot squeeze a fixed column out
  // from under its heading.
  number: 'w-12 shrink-0',
  id: 'w-16 shrink-0',
  label: 'flex-1 min-w-0',
  remove: 'w-6 shrink-0',
  side: 'w-24 shrink-0',
  type: 'flex-1 min-w-0',
};

export function MicrocontrollerProperties({ node, updateData }: NodePropertiesProps) {
  const config = getEffectiveMcuConfig(node.data);
  const [activeTab, setActiveTab] = useState<'code' | 'pins' | 'geometry'>('code');

  const setConfig = (newConfig: McuGeometryConfig) => {
    updateData('mcuConfig', newConfig);
    // Also update packageId on the node so PCB exporter uses the matching
    // footprint. Shared with the MCP bridge, which has to write the same pair.
    updateData('packageId', mcuPackageId(newConfig));
  };

  const handlePresetChange = (presetKey: string) => {
    const preset = MCU_PRESETS.find(p => p.key === presetKey);
    if (preset) {
      setConfig({ ...preset.config });
    }
  };

  const handleAddPin = () => {
    const nextNum = config.pins.length + 1;
    const newPin: McuPinDef = {
      id: `P${nextNum}`,
      label: `IO${nextNum}`,
      type: 'io',
      side: config.pins.filter(p => p.side === 'left').length <= config.pins.filter(p => p.side === 'right').length ? 'left' : 'right',
      pinNumber: nextNum,
    };
    setConfig({
      ...config,
      presetKey: 'custom',
      pins: [...config.pins, newPin],
      pinCount: config.pins.length + 1,
    });
  };

  const handleRemovePin = (idx: number) => {
    if (config.pins.length <= 1) return;
    const newPins = config.pins.filter((_, i) => i !== idx);
    setConfig({
      ...config,
      presetKey: 'custom',
      pins: newPins,
      pinCount: newPins.length,
    });
  };

  const handleUpdatePin = (idx: number, patch: Partial<McuPinDef>) => {
    const newPins = config.pins.map((p, i) => i === idx ? { ...p, ...patch } : p);
    setConfig({
      ...config,
      presetKey: 'custom',
      pins: newPins,
    });
  };

  const insertPinInCode = (pinId: string) => {
    const currentCode = (node.data.code as string) || '';
    updateData('code', currentCode + `\n// Pin ${pinId}\npinMode('${pinId}', 'OUTPUT');\ndigitalWrite('${pinId}', 1);`);
  };

  return (
    <div className="space-y-3">
      {/* Tab Switcher */}
      <div className="flex border-b border-gray-200 dark:border-slate-800 text-xs">
        <button
          onClick={() => setActiveTab('code')}
          className={`pb-1 px-2.5 font-semibold transition-colors flex items-center gap-1 ${
            activeTab === 'code'
              ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
          }`}
        >
          <span>JS Code</span>
        </button>
        <button
          onClick={() => setActiveTab('pins')}
          className={`pb-1 px-2.5 font-semibold transition-colors flex items-center gap-1 ${
            activeTab === 'pins'
              ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
          }`}
        >
          <Cpu size={13} />
          <span>Pins ({config.pins.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('geometry')}
          className={`pb-1 px-2.5 font-semibold transition-colors flex items-center gap-1 ${
            activeTab === 'geometry'
              ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
          }`}
        >
          <Wrench size={13} />
          <span>Geometry</span>
        </button>
      </div>

      {activeTab === 'code' && (
        <>
          {/* Quick Pin Badges to Click and Insert */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
              Active Pins (Click to insert snippet)
            </label>
            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto p-1 bg-gray-50 dark:bg-slate-950 rounded border border-gray-200 dark:border-slate-800">
              {config.pins.map(p => (
                <button
                  key={p.id}
                  onClick={() => insertPinInCode(p.id)}
                  title={`Insert code for ${p.id} (${p.label})`}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-all hover:scale-105 ${
                    p.type === 'power'
                      ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                      : p.type === 'ground'
                      ? 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      : p.type === 'analog'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                  }`}
                >
                  {p.id}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
              JavaScript Program
            </label>
            <textarea
              value={
                (node.data.code as string) ??
                `pinMode('${config.pins[0]?.id || 'D0'}', 'OUTPUT');\nwhile(true) {\n  digitalWrite('${config.pins[0]?.id || 'D0'}', 1);\n  sleep(500);\n  digitalWrite('${config.pins[0]?.id || 'D0'}', 0);\n  sleep(500);\n}`
              }
              onChange={e => updateData('code', e.target.value)}
              className="w-full text-xs font-mono border border-gray-300 dark:border-slate-700 rounded px-2 py-1.5 h-44 whitespace-pre bg-gray-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
              spellCheck="false"
            />
          </div>

          {node.data.logs && (node.data.logs as string[]).length > 0 && (
            <div className="flex flex-col">
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1 uppercase tracking-wider">
                Serial Monitor Output
              </label>
              <div className="bg-gray-950 text-emerald-400 font-mono text-[10px] p-2 h-28 overflow-y-auto rounded shadow-inner whitespace-pre-wrap border border-slate-800">
                {(node.data.logs as string[]).map((log, i) => (
                  <div key={i}>{log}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'pins' && (
        <div className="space-y-3">
          {/* Preset Selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
              Form Factor & Board Preset
            </label>
            <select
              value={config.presetKey || 'custom'}
              onChange={e => handlePresetChange(e.target.value)}
              className="w-full text-xs border border-gray-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              {MCU_PRESETS.map(preset => (
                <option key={preset.key} value={preset.key}>
                  {preset.name}
                </option>
              ))}
              <option value="custom">Custom Configuration ({config.pins.length} pins)</option>
            </select>
          </div>

          {/* Pin Table */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">
                Pin Definitions ({config.pins.length})
              </span>
              <button
                onClick={handleAddPin}
                className="flex items-center gap-1 text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 dark:text-indigo-300 font-semibold px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 transition-colors"
              >
                <Plus size={11} /> Add Pin
              </button>
            </div>

            {/*
              A pin carries three names and they are not interchangeable: one
              is milled onto the copper, one is what the rest of the app calls
              the pin, one is only ever drawn. Saying so once here beats three
              tooltips nobody hovers.
            */}
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-1.5 leading-snug">
              <span className="font-semibold text-gray-500 dark:text-slate-400">Pad</span> is the
              number stamped on the PCB pad,{' '}
              <span className="font-semibold text-gray-500 dark:text-slate-400">ID</span> is what
              wires and your code address, and{' '}
              <span className="font-semibold text-gray-500 dark:text-slate-400">Label</span> is the
              name drawn beside the pin on the schematic. Leave Pad or Label blank to fall back to
              the list position and the ID.
            </p>

            <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-slate-800 rounded divide-y divide-gray-100 dark:divide-slate-800">
              {/*
                Sticky, because the list runs to 36 rows on a module like the
                Heltec and a heading that scrolls away is no heading at all.
              */}
              <div className="sticky top-0 z-10 flex flex-col gap-1 p-1.5 bg-gray-50 dark:bg-slate-950 border-b border-gray-200 dark:border-slate-800 text-[9px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">
                <div className="flex items-center gap-1">
                  <span className={PIN_COL.number} title="Pad number on the PCB">Pad</span>
                  <span className={PIN_COL.id} title="What wires connect to and code addresses">ID</span>
                  <span className={PIN_COL.label} title="Name drawn beside the pin on the schematic">Label</span>
                  <span className={PIN_COL.remove} />
                </div>
                <div className="flex items-center gap-1">
                  <span className={PIN_COL.side}>Side</span>
                  <span className={PIN_COL.type}>Type</span>
                </div>
              </div>
              {config.pins.map((pin, idx) => (
                <div key={idx} className="p-1.5 flex flex-col gap-1 text-xs bg-white dark:bg-slate-900">
                  <div className="flex items-center gap-1">
                    {/* Physical pin number — what the pad is stamped with on the board. */}
                    <input
                      type="text"
                      value={pin.pinNumber ?? ''}
                      onChange={e => handleUpdatePin(idx, { pinNumber: parsePinNumber(e.target.value) })}
                      placeholder={String(idx + 1)}
                      title="Pad number on the PCB (blank = position in this list)"
                      className={`${PIN_COL.number} text-[10px] font-mono px-1 py-0.5 border border-gray-200 dark:border-slate-700 rounded bg-gray-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400`}
                    />
                    {/* Pin ID */}
                    <input
                      type="text"
                      value={pin.id}
                      onChange={e => handleUpdatePin(idx, { id: e.target.value.trim() })}
                      placeholder="ID"
                      title="Handle id — what wires connect to and what code addresses"
                      className={`${PIN_COL.id} text-xs font-mono font-bold px-1.5 py-0.5 border border-gray-200 dark:border-slate-700 rounded bg-gray-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200`}
                    />
                    {/* Schematic label */}
                    <input
                      type="text"
                      value={pin.label ?? ''}
                      onChange={e => handleUpdatePin(idx, { label: e.target.value })}
                      placeholder={pin.id || 'Label'}
                      title="Name drawn beside the pin on the schematic (blank = the id)"
                      className={`${PIN_COL.label} text-xs font-mono px-1.5 py-0.5 border border-gray-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300`}
                    />
                    {/* Remove Pin Button */}
                    <button
                      onClick={() => handleRemovePin(idx)}
                      title="Remove Pin"
                      className={`${PIN_COL.remove} flex justify-center text-gray-400 hover:text-red-500 rounded transition-colors`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Side */}
                    <select
                      value={pin.side}
                      onChange={e => handleUpdatePin(idx, { side: e.target.value as McuPinSide })}
                      className={`${PIN_COL.side} text-[11px] px-1 py-0.5 border border-gray-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer`}
                    >
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                    </select>
                    {/* Type */}
                    <select
                      value={pin.type}
                      onChange={e => handleUpdatePin(idx, { type: e.target.value as McuPinType })}
                      className={`${PIN_COL.type} text-[11px] px-1 py-0.5 border border-gray-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer`}
                    >
                      <option value="io">IO</option>
                      <option value="analog">Analog</option>
                      <option value="power">Power</option>
                      <option value="ground">GND</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'geometry' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
              Package Form Factor Style
            </label>
            <select
              value={config.style}
              onChange={e => {
                const style = e.target.value as any;
                const newCfg = createCustomMcuConfig(config.pins.length, style, {
                  widthMm: config.widthMm,
                  heightMm: config.heightMm,
                  isSmd: config.isSmd,
                  pitchMm: config.pitchMm,
                });
                setConfig(newCfg);
              }}
              className="w-full text-xs border border-gray-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <option value="dip">DIP (Dual In-line Package)</option>
              <option value="header_2x">Dual Header Module / Dev Board</option>
              <option value="header_matrix">2xN Dupont Header Matrix (e.g. 2x4 CC1101)</option>
              <option value="header_1x">Single Inline Header (1xN)</option>
              <option value="quad">4-Sided SMD Module / QFP</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-400 mb-0.5">
                Width (mm)
              </label>
              <NumberInput
                step={0.5}
                min={3}
                max={150}
                value={config.widthMm}
                onChange={v => setConfig({ ...config, widthMm: v, presetKey: 'custom' })}
                      className="w-full text-xs px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                    />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-400 mb-0.5">
                Height (mm)
              </label>
              <NumberInput
                step={0.5}
                min={3}
                max={200}
                value={config.heightMm}
                onChange={v => setConfig({ ...config, heightMm: v, presetKey: 'custom' })}
                      className="w-full text-xs px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                    />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-400 mb-0.5">
                Pin Pitch (mm)
              </label>
              <select
                value={config.pitchMm}
                onChange={e => setConfig({ ...config, pitchMm: parseFloat(e.target.value) || 2.54, presetKey: 'custom' })}
                className="w-full text-xs px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              >
                <option value="2.54">2.54mm (0.1" standard)</option>
                <option value="2.0">2.0mm</option>
                <option value="1.27">1.27mm (SOIC / 0.05")</option>
                <option value="0.8">0.8mm</option>
                <option value="0.5">0.5mm</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-400 mb-0.5">
                Pad Mounting
              </label>
              <select
                value={config.isSmd ? 'smd' : 'tht'}
                onChange={e => setConfig({ ...config, isSmd: e.target.value === 'smd', presetKey: 'custom' })}
                className="w-full text-xs px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              >
                <option value="tht">Through-Hole (Drilled)</option>
                <option value="smd">Surface-Mount (SMD)</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function MicrocontrollerNode({ data, selected }: any) {
  const config = getEffectiveMcuConfig(data);
  const { pins } = config;

  const leftPins = pins.filter(p => p.side === 'left');
  // A counter-clockwise part (DIP, Pico) numbers the right column from the
  // bottom up, so it is drawn that way too - the symbol has to read the same
  // way round as the footprint that gets drilled, or a module seats reversed.
  const rightColumn = pins.filter(p => p.side === 'right');
  const rightPins = rightColumnRunsUp(config) ? [...rightColumn].reverse() : rightColumn;
  const topPins = pins.filter(p => p.side === 'top');
  const bottomPins = pins.filter(p => p.side === 'bottom');

  const maxSidePins = Math.max(leftPins.length, rightPins.length, 4);
  const maxEdgePins = Math.max(topPins.length, bottomPins.length, 0);

  const cardWidth = Math.max(96, (maxEdgePins + 1) * 24);
  const cardHeight = Math.max(128, 28 + maxSidePins * 22);

  const getPinHandleColor = (pin: McuPinDef) => {
    if (pin.type === 'power') return '!bg-red-500';
    if (pin.type === 'ground') return '!bg-gray-400';
    if (pin.type === 'analog') return '!bg-emerald-400';
    return '!bg-sky-400';
  };

  const getPinTextColor = (pin: McuPinDef) => {
    if (pin.type === 'power') return 'text-red-400';
    if (pin.type === 'ground') return 'text-gray-400';
    if (pin.type === 'analog') return 'text-emerald-400';
    return 'text-sky-300';
  };

  const displayName = config.presetKey && config.presetKey !== 'custom'
    ? (MCU_PRESETS.find(p => p.key === config.presetKey)?.name.replace(/\(.*\)/, '').trim() || 'MCU')
    : (data?.label || 'MCU');

  return (
    <div
      style={{ width: `${cardWidth}px`, height: `${cardHeight}px` }}
      className={`${DEVICE_CARD_DARK} flex flex-col relative select-none ${selected ? '!border-emerald-500 shadow-lg shadow-emerald-500/20' : ''}`}
    >
      {/* Top Header */}
      <div className="bg-gray-900 text-white text-[9px] font-bold text-center h-5 uppercase tracking-wider rounded-t border-b border-gray-800 flex items-center justify-center px-1 truncate">
        {displayName}
      </div>

      {/* Top Pins Row */}
      {topPins.length > 0 && (
        <div className="absolute top-0 inset-x-0 flex justify-around px-3 -mt-1.5 z-20">
          {topPins.map(pin => (
            <div key={pin.id} className="relative flex flex-col items-center">
              <Handle
                type="source"
                position={Position.Top}
                id={pin.id}
                className={`w-2 h-2 ${getPinHandleColor(pin)} !border-gray-900`}
                style={{ top: 0, left: 'auto', right: 'auto' }}
              />
              <span className={`text-[7px] font-mono font-bold mt-2 ${getPinTextColor(pin)}`}>
                {pin.label || pin.id}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Center Body (Left and Right Pins) */}
      <div className="flex-1 flex justify-between pt-[3px] pb-[5px] relative">
        {/* Left Side Pins */}
        <div className="flex flex-col justify-start h-full items-start pl-1 z-10">
          {leftPins.map(pin => (
            <div key={pin.id} className="relative flex items-center h-6">
              <span className={`text-[8px] font-mono font-semibold mr-1 ${getPinTextColor(pin)}`}>
                {pin.label || pin.id}
              </span>
              <Handle
                type="source"
                position={Position.Left}
                id={pin.id}
                className={`w-2 h-2 ${getPinHandleColor(pin)} !border-gray-900 -ml-2`}
                /*
                 * No `top: auto`. That cancels React Flow's own centring, so the
                 * pin took its static position in the flex row and the centring
                 * transform then pulled it off the row's middle — landing at
                 * 9.5px into a 24px row, which is off the 4px snap grid and so
                 * unreachable by any neighbour's pin.
                 */
              />
            </div>
          ))}
        </div>

        {/* Center Aesthetic Chip Graphics */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-40">
          <div className="w-10 h-10 rounded-lg border border-gray-700 flex items-center justify-center">
            <Cpu size={18} className="text-gray-500" />
          </div>
          <div className="text-[7px] font-mono text-gray-500 mt-1">
            {pins.length}P
          </div>
        </div>

        {/* Right Side Pins */}
        <div className="flex flex-col justify-start h-full items-end pr-1 z-10">
          {rightPins.map(pin => (
            <div key={pin.id} className="relative flex items-center justify-end h-6">
              <Handle
                type="source"
                position={Position.Right}
                id={pin.id}
                className={`w-2 h-2 ${getPinHandleColor(pin)} !border-gray-900 -mr-2`}
              />
              <span className={`text-[8px] font-mono font-semibold ml-1 ${getPinTextColor(pin)}`}>
                {pin.label || pin.id}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Pins Row */}
      {bottomPins.length > 0 && (
        <div className="absolute bottom-0 inset-x-0 flex justify-around px-3 -mb-1.5 z-20">
          {bottomPins.map(pin => (
            <div key={pin.id} className="relative flex flex-col items-center">
              <span className={`text-[7px] font-mono font-bold mb-2 ${getPinTextColor(pin)}`}>
                {pin.label || pin.id}
              </span>
              <Handle
                type="source"
                position={Position.Bottom}
                id={pin.id}
                className={`w-2 h-2 ${getPinHandleColor(pin)} !border-gray-900`}
                style={{ bottom: 0, left: 'auto', right: 'auto' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

