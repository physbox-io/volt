import { sanitizeSpiceValue } from '../../utils/spice';
import type { NodePropertiesProps } from './registry';
import {
  LeadHandles,
  RotatedSymbol,
  SchematicLabel,
  leadBoxStyle,
  resolveOrientation,
} from './schematic';

export function ldrDefaultData() {
  return { label: 'LDR', r_dark: 100000, r_dark_label: '100k', lightLevel: 0.5 };
}

export function LDRProperties({ node, updateData, webcam }: NodePropertiesProps) {
  const { stream, videoRef, isRecordingWebcam, startRecordingWebcam } = webcam;
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Dark Resistance</label>
        <input
          type="text"
          value={(node.data.r_dark_label as string) || '100k'}
          onChange={e => {
            updateData('r_dark_label', e.target.value);
            updateData('r_dark', sanitizeSpiceValue(e.target.value));
          }}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div className="mb-3 flex items-center gap-2">
        <input
          type="checkbox"
          id="ldr-webcam"
          checked={!!node.data.isWebcamActive}
          onChange={e => updateData('isWebcamActive', e.target.checked)}
          className="cursor-pointer"
        />
        <label htmlFor="ldr-webcam" className="text-xs font-semibold text-gray-700 dark:text-gray-300 select-none cursor-pointer">
          Use Webcam Sensor
        </label>
      </div>

      {stream && (
        <div className="mb-3 rounded-lg overflow-hidden border border-gray-300 dark:border-slate-800 h-28 bg-black relative flex items-center justify-center shadow-inner">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
          />
          <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[8px] font-mono px-1.5 py-0.5 rounded shadow-sm">
            Live LDR Light: {Math.round((node.data.lightLevel ?? 0) * 100)}%
          </div>
        </div>
      )}

      {!!node.data.isWebcamActive && (
        <div className="mb-3">
          <button
            onClick={isRecordingWebcam ? undefined : startRecordingWebcam}
            className={`w-full py-2 rounded-lg font-bold text-xs shadow-md transition-all text-white ${
              isRecordingWebcam ? 'bg-red-500 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg'
            }`}
          >
            {isRecordingWebcam ? '🔴 Recording Webcam...' : '📹 Record Light Stream'}
          </button>
          {node.data.pwlData && (
            <div className="text-[9px] text-green-600 dark:text-green-400 font-bold mt-1.5 flex items-center gap-1">
              <span>✓</span> PWL Light Stream Loaded ({node.data.pwlData.length} pts)
            </div>
          )}
        </div>
      )}

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Light Exposure (0-100%)
        </label>
        <input
          type="range"
          min="0"
          max="100"
          disabled={!!node.data.isWebcamActive}
          value={Math.round((node.data.lightLevel ?? 0.5) * 100)}
          onChange={e => updateData('lightLevel', parseInt(e.target.value) / 100)}
          className="w-full"
        />
        <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono mt-1 flex justify-between">
          <span>Light: {Math.round((node.data.lightLevel ?? 0.5) * 100)}%</span>
          <span>R: {Math.round(100 + ((node.data.r_dark ?? 100000) - 100) * (1 - (node.data.lightLevel ?? 0.5))).toLocaleString()} Ω</span>
        </div>
      </div>
    </>
  );
}

export function LDRNode({ data, selected }: any) {
  // const rDarkLabel = data.r_dark_label || '100k';
  const lightLevel = data.lightLevel ?? 0;
  const isWebcamActive = !!data.isWebcamActive;

  const orientation = resolveOrientation(data.orientation);

  return (
    <div
      className="schematic-node flex items-center justify-center relative select-none"
      style={leadBoxStyle(orientation, 48, 48)}
    >
      <LeadHandles first="in" second="out" orientation={orientation} />

      {/* Symbol SVG */}
      <RotatedSymbol orientation={orientation} width={48} height={48}>
      <svg 
        width="48" 
        height="48" 
        viewBox="0 0 48 48" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.4" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {/* Left & Right leads */}
        <path d="M 0 24 H 14" />
        <path d="M 34 24 H 48" />

        {/* Resistor zig-zag */}
        <path d="M 14 24 L 16 18 L 20 30 L 24 18 L 28 30 L 32 18 L 34 24" />

        {/* Enclosing Circle */}
        <circle cx="24" cy="24" r="13" />

        {/* Light Illumination Arrows */}
        <path d="M 12 10 L 18 16" strokeWidth="1" />
        <path d="M 15 16 H 18 V 13" strokeWidth="1" />
        
        <path d="M 17 6 L 23 12" strokeWidth="1" />
        <path d="M 20 12 H 23 V 9" strokeWidth="1" />
      </svg>
      </RotatedSymbol>

      {/* Label and light level status */}
      <SchematicLabel placement={orientation.labelPlacement}>
        LDR • {isWebcamActive ? '📹 ' : ''}{Math.round(lightLevel * 100)}%
      </SchematicLabel>
    </div>
  );
}
