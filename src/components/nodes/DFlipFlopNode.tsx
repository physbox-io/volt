import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';

export function dffDefaultData() {
  return { label: 'DFF' };
}

export function DFlipFlopProperties(_props: NodePropertiesProps) {
  return (
    <div className="mb-3 p-2.5 bg-indigo-50 dark:bg-slate-800/40 border border-indigo-100 dark:border-slate-800 rounded-lg text-xs text-indigo-900 dark:text-indigo-200 shadow-sm leading-relaxed">
      <strong className="block mb-1 text-[11px] font-bold text-indigo-950 dark:text-indigo-150 uppercase tracking-wider">D Flip-Flop</strong>
      Rising-edge triggered. Samples the D input and sets Q accordingly on each positive edge of CLK.
    </div>
  );
}

export function DFlipFlopNode({ selected }: any) {
  return (
    <div className="schematic-node bg-transparent w-[80px] h-[80px] relative flex items-center justify-center select-none">
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 100 100" 
        style={{ overflow: 'visible' }}
        className={`absolute top-0 left-0 transition-all ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {/* Leads */}
        <g 
          className="stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          {/* D input lead */}
          <path d="M -4 30 H 20" />
          {/* CLK input lead */}
          <path d="M -4 70 H 20" />
          {/* Q output lead */}
          <path d="M 80 30 H 104" />
          {/* Qbar output lead */}
          <path d="M 80 70 H 104" />
        </g>

        {/* Main IC body */}
        <rect 
          x="20" 
          y="15" 
          width="60" 
          height="70" 
          rx="4"
          className="fill-white dark:fill-slate-900 stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75"
          strokeLinejoin="round"
        />

        {/* CLK input triangle */}
        <path 
          d="M 20 62 L 30 70 L 20 78" 
          className="stroke-slate-700 dark:stroke-slate-200 fill-none transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75" 
        />

        {/* Text Labels inside the box */}
        <text x="26" y="36" fontSize="10" fontWeight="bold" className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans">D</text>
        <text x="32" y="74" fontSize="8" fontWeight="bold" className="fill-slate-700 dark:fill-slate-400 transition-colors font-mono">CLK</text>
        <text x="62" y="36" fontSize="10" fontWeight="bold" className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans">Q</text>
        
        {/* Q_bar (Q with bar) */}
        <text x="62" y="76" fontSize="10" fontWeight="bold" className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans">Q</text>
        <line 
          x1="62" 
          y1="64" 
          x2="70" 
          y2="64" 
          className="stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.25" 
        />

        {/* Subtitle */}
        <text x="38" y="54" fontSize="8" fontWeight="bold" className="fill-slate-400 dark:fill-slate-500 uppercase tracking-widest font-sans">DFF</text>
      </svg>

      {/* D Input */}
      <Handle type="target" position={Position.Left} id="d" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />
      <Handle type="source" position={Position.Left} id="d" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />

      {/* CLK Input */}
      <Handle type="target" position={Position.Left} id="clk" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />
      <Handle type="source" position={Position.Left} id="clk" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />

      {/* Q Output */}
      <Handle type="source" position={Position.Right} id="q" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />
      <Handle type="target" position={Position.Right} id="q" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />

      {/* Q_bar Output */}
      <Handle type="source" position={Position.Right} id="qbar" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />
      <Handle type="target" position={Position.Right} id="qbar" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />
    </div>
  );
}
