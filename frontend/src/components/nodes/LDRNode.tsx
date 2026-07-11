import { Handle, Position } from '@xyflow/react';

export function LDRNode({ data, selected }: any) {
  // const rDarkLabel = data.r_dark_label || '100k';
  const lightLevel = data.lightLevel ?? 0;
  const isWebcamActive = !!data.isWebcamActive;

  return (
    <div className="schematic-node flex items-center justify-center relative select-none w-[48px] h-[48px]">
      {/* Bidirectional Left Handle */}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="in" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '50%', left: '0%' }}
      />
      <Handle 
        type="source" 
        position={Position.Left} 
        id="in" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '50%', left: '0%' }}
      />

      {/* Symbol SVG */}
      <svg 
        width="48" 
        height="48" 
        viewBox="0 0 48 48" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {/* Left & Right leads */}
        <path d="M 0 24 H 14" />
        <path d="M 34 24 H 48" />

        {/* Resistor zig-zag */}
        <path d="M 14 24 L 16 18 L 20 30 L 24 18 L 28 30 L 32 18 L 34 24" />

        {/* Enclosing Circle */}
        <circle cx="24" cy="24" r="13" />

        {/* Light Illumination Arrows */}
        <path d="M 12 10 L 18 16" strokeWidth="1.0" />
        <path d="M 15 16 H 18 V 13" strokeWidth="1.0" />
        
        <path d="M 17 6 L 23 12" strokeWidth="1.0" />
        <path d="M 20 12 H 23 V 9" strokeWidth="1.0" />
      </svg>

      {/* Label and light level status */}
      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[7px] font-bold font-mono text-slate-600 dark:text-slate-400 text-center pointer-events-none whitespace-nowrap">
        LDR • {isWebcamActive ? '📹 ' : ''}{Math.round(lightLevel * 100)}%
      </div>

      {/* Bidirectional Right Handle */}
      <Handle 
        type="source" 
        position={Position.Right} 
        id="out" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '50%', left: '100%' }}
      />
      <Handle 
        type="target" 
        position={Position.Right} 
        id="out" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '50%', left: '100%' }}
      />
    </div>
  );
}
