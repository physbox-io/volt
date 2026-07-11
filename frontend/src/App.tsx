import { useState, useCallback, useRef, useEffect, type DragEvent } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  ReactFlowProvider,
  useReactFlow,
  ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ResistorNode } from './components/nodes/ResistorNode';
import { VoltageNode } from './components/nodes/VoltageNode';
import { GroundNode } from './components/nodes/GroundNode';
import { LEDNode } from './components/nodes/LEDNode';
import { CapacitorNode } from './components/nodes/CapacitorNode';
import { Timer555Node } from './components/nodes/Timer555Node';
import { OpAmpNode } from './components/nodes/OpAmpNode';
import { MultimeterNode } from './components/nodes/MultimeterNode';
import { SignalGeneratorNode } from './components/nodes/SignalGeneratorNode';
import { ScopeNode } from './components/nodes/ScopeNode';
import { SpeakerNode } from './components/nodes/SpeakerNode';
import { MicrophoneNode } from './components/nodes/MicrophoneNode';
import { NpnNode } from './components/nodes/NpnNode';
import { PnpNode } from './components/nodes/PnpNode';
import { NmosNode } from './components/nodes/NmosNode';
import { PmosNode } from './components/nodes/PmosNode';
import { DiodeNode } from './components/nodes/DiodeNode';
import { ZenerDiodeNode } from './components/nodes/ZenerDiodeNode';
import { ACVoltageNode } from './components/nodes/ACVoltageNode';
import { MicrocontrollerNode } from './components/nodes/MicrocontrollerNode';
import { AndNode } from './components/nodes/AndNode';
import { OrNode } from './components/nodes/OrNode';
import { NotNode } from './components/nodes/NotNode';
import { NandNode } from './components/nodes/NandNode';
import { NorNode } from './components/nodes/NorNode';
import { XorNode } from './components/nodes/XorNode';
import { InductorNode } from './components/nodes/InductorNode';
import { SwitchNode } from './components/nodes/SwitchNode';
import { generateSpiceNetlist, sanitizeSpiceValue } from './utils/spice';
import { Play, Square, Trash2, Info, Menu, X, AlertCircle, Settings, Save, Crosshair, Sparkles, Sun, Moon, Zap, Activity } from 'lucide-react';
import AICopilotPanel from './components/AICopilotPanel';
import { playbackTicker } from './utils/playbackTicker';
import { presets } from './utils/presets';
import { AuraEdge, EdgePathProvider } from './components/AuraEdge';
import { SettingsModal } from './components/SettingsModal';
import { loadSettings, saveSettings, loadUserPresets, addUserPreset, removeUserPreset, nameToKey, type CircuitPreset } from './utils/storage';
import { PotentiometerNode } from './components/nodes/PotentiometerNode';
import { SevenSegmentNode } from './components/nodes/SevenSegmentNode';
import { CurrentSourceNode } from './components/nodes/CurrentSourceNode';
import { datasheets } from './utils/datasheets';
import { useMCPBridge } from './hooks/useMCPBridge';

const edgeTypes = {
  aura: AuraEdge,
  smoothstep: AuraEdge,
  straight: AuraEdge,
  step: AuraEdge,
};
import { Logo } from './components/Logo';
import { DocsModal } from './components/DocsModal';

const nodeTypes = {
  resistor: ResistorNode,
  voltage: VoltageNode,
  ground: GroundNode,
  led: LEDNode,
  capacitor: CapacitorNode,
  timer555: Timer555Node,
  opamp: OpAmpNode,
  multimeter: MultimeterNode,
  signalgen: SignalGeneratorNode,
  scope: ScopeNode,
  speaker: SpeakerNode,
  microphone: MicrophoneNode,
  npn: NpnNode,
  pnp: PnpNode,
  nmos: NmosNode,
  pmos: PmosNode,
  diode: DiodeNode,
  zener: ZenerDiodeNode,
  acvoltage: ACVoltageNode,
  mcu: MicrocontrollerNode,
  and: AndNode,
  or: OrNode,
  not: NotNode,
  nand: NandNode,
  nor: NorNode,
  xor: XorNode,
  inductor: InductorNode,
  switch: SwitchNode,
  potentiometer: PotentiometerNode,
  sevenseg: SevenSegmentNode,
  currentsource: CurrentSourceNode,
};

let simulationWorker: Worker | null = null;
const pendingSimulations = new Map<string, { resolve: (res: any) => void; reject: (err: any) => void }>();

const getSimulationWorker = () => {
  if (!simulationWorker) {
    simulationWorker = new Worker(new URL('./workers/simulation.worker.ts', import.meta.url), { type: 'module' });
    simulationWorker.onmessage = (evt) => {
      const { type, id, result, ok, error } = evt.data;
      if (type === 'RESULT') {
        const pending = pendingSimulations.get(id);
        if (pending) {
          pendingSimulations.delete(id);
          if (ok) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error));
          }
        }
      }
    };
    simulationWorker.onerror = (err) => {
      console.error("[SimulationWorker] General error:", err);
      terminateWorker();
    };
  }
  return simulationWorker;
};

const terminateWorker = () => {
  if (simulationWorker) {
    simulationWorker.terminate();
    simulationWorker = null;
  }
  for (const pending of pendingSimulations.values()) {
    pending.reject(new Error("Simulation worker terminated."));
  }
  pendingSimulations.clear();
};

const runSimInWorker = (netlist: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    pendingSimulations.set(id, { resolve, reject });
    try {
      const worker = getSimulationWorker();
      worker.postMessage({ type: 'RUN', id, netlist });
    } catch (err) {
      reject(err);
    }
  });
};

let nodeId = 1;

function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  const onDragStart = (event: DragEvent, nodeType: string, label?: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    if (label) event.dataTransfer.setData('application/reactflow-label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="fixed inset-0 z-40 lg:relative lg:z-10 flex h-full pointer-events-none">
      {/* Backdrop for mobile */}
      <div 
        className="fixed inset-0 bg-slate-900/20 backdrop-blur-xs lg:hidden pointer-events-auto" 
        onClick={onClose}
      ></div>
      <aside className="w-64 h-full glass-panel border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-4 bg-white/95 dark:bg-slate-900/95 shadow-xl lg:shadow-none z-50 relative overflow-y-auto pointer-events-auto transition-colors">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Components</h2>
          <button onClick={onClose} className="lg:hidden p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 dark:text-slate-400">
            <X size={20} />
          </button>
        </div>
      
        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 mt-2">Transistors</div>
        <div className="grid grid-cols-2 gap-2">
          <div 
            onDragStart={(event) => onDragStart(event, 'npn')} 
            draggable 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center text-center cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group"
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="24" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="20" y1="10" x2="20" y2="50" strokeWidth="3" />
                <line x1="5" y1="30" x2="20" y2="30" />
                <line x1="20" y1="20" x2="45" y2="7" />
                <line x1="20" y1="40" x2="45" y2="53" />
                <polygon points="45,53 35,46 41,38" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">NPN BJT</span>
          </div>
          <div 
            onDragStart={(event) => onDragStart(event, 'pnp')} 
            draggable 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center text-center cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group"
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="24" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="20" y1="10" x2="20" y2="50" strokeWidth="3" />
                <line x1="5" y1="30" x2="20" y2="30" />
                <line x1="20" y1="20" x2="45" y2="7" />
                <line x1="20" y1="40" x2="45" y2="53" />
                <polygon points="20,20 30,17 26,27" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">PNP BJT</span>
          </div>
          <div 
            onDragStart={(event) => onDragStart(event, 'nmos')} 
            draggable 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center text-center cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group"
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="24" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="15" y1="15" x2="15" y2="45" strokeWidth="3" />
                <line x1="22" y1="15" x2="22" y2="45" strokeWidth="3" />
                <line x1="5" y1="30" x2="15" y2="30" />
                <line x1="22" y1="20" x2="45" y2="20" />
                <line x1="22" y1="40" x2="45" y2="40" />
                <line x1="22" y1="30" x2="45" y2="30" />
                <polygon points="22,30 32,25 32,35" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">NMOS</span>
          </div>
          <div 
            onDragStart={(event) => onDragStart(event, 'pmos')} 
            draggable 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center text-center cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group"
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="24" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="15" y1="15" x2="15" y2="45" strokeWidth="3" />
                <line x1="22" y1="15" x2="22" y2="45" strokeWidth="3" />
                <line x1="5" y1="30" x2="15" y2="30" />
                <line x1="22" y1="20" x2="45" y2="20" />
                <line x1="22" y1="40" x2="45" y2="40" />
                <line x1="22" y1="30" x2="45" y2="30" />
                <polygon points="45,30 35,25 35,35" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">PMOS</span>
          </div>
        </div>

        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 mt-2">Logic Gates</div>
        <div className="grid grid-cols-2 gap-2">
          {['and', 'or', 'not', 'nand', 'nor', 'xor'].map(gate => (
            <div 
              key={gate}
              onDragStart={(event) => onDragStart(event, gate)} 
              draggable 
              className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center text-center cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group"
            >
              <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
                {gate === 'and' && (
                  <svg width="24" height="24" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M 20 20 H 50 A 30 30 0 0 1 80 50 A 30 30 0 0 1 50 80 H 20 Z" />
                  </svg>
                )}
                {gate === 'or' && (
                  <svg width="24" height="24" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M 20 20 C 35 20, 50 30, 80 50 C 50 70, 35 80, 20 80 C 35 50, 35 50, 20 20 Z" />
                  </svg>
                )}
                {gate === 'not' && (
                  <svg width="24" height="24" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="20,20 20,80 70,50" />
                    <circle cx="78" cy="50" r="8" fill="none" />
                  </svg>
                )}
                {gate === 'nand' && (
                  <svg width="24" height="24" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M 15 20 H 45 A 30 30 0 0 1 75 50 A 30 30 0 0 1 45 80 H 15 Z" />
                    <circle cx="83" cy="50" r="8" fill="none" />
                  </svg>
                )}
                {gate === 'nor' && (
                  <svg width="24" height="24" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M 15 20 C 30 20, 45 30, 75 50 C 45 70, 30 80, 15 80 C 30 50, 30 50, 15 20 Z" />
                    <circle cx="83" cy="50" r="8" fill="none" />
                  </svg>
                )}
                {gate === 'xor' && (
                  <svg width="24" height="24" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M 15 20 C 25 35, 25 65, 15 80" />
                    <path d="M 22 20 C 37 20, 52 30, 82 50 C 52 70, 37 80, 22 80 C 37 50, 37 50, 22 20 Z" />
                  </svg>
                )}
              </div>
              <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 capitalize">{gate} Gate</span>
            </div>
          ))}
        </div>

        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 mt-2">Tools</div>
        <div className="grid grid-cols-2 gap-2">
          {/* DC Voltage */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'voltage', '5V')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="16" />
                <path d="M 24 13 V 19" />
                <path d="M 21 16 H 27" />
                <path d="M 21 32 H 27" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">DC Voltage</span>
          </div>

          {/* Ground */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'ground')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-green-600 dark:text-green-400">
              <svg width="24" height="20" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 6h16 M7 11h10 M10 16h4" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Ground</span>
          </div>

          {/* Resistor */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'resistor', '1k')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="36" height="18" viewBox="0 0 80 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 20 H 25 L 27.5 10 L 32.5 30 L 37.5 10 L 42.5 30 L 47.5 10 L 52.5 30 L 55 20 H 80" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Resistor</span>
          </div>

          {/* Capacitor */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'capacitor', '10u')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="30" height="22" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 24 H 29" />
                <path d="M 29 12 V 36" strokeWidth="2.5" />
                <path d="M 35 12 V 36" strokeWidth="2.5" />
                <path d="M 35 24 H 64" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Capacitor</span>
          </div>

          {/* Inductor */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'inductor', '100u')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="36" height="18" viewBox="0 0 80 40" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M 0 20 H 16 A 6,6 0 0,1 28,20 A 6,6 0 0,1 40,20 A 6,6 0 0,1 52,20 A 6,6 0 0,1 64,20 H 80" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Inductor</span>
          </div>

          {/* Diode */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'diode')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="30" height="22" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 24 H 24" />
                <path d="M 24 14 L 36 24 L 24 34 Z" fill="currentColor" />
                <path d="M 36 14 V 34" strokeWidth="2.5" />
                <path d="M 36 24 H 64" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Diode</span>
          </div>

          {/* LED */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'led')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="30" height="22" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 24 H 24" />
                <path d="M 24 14 L 36 24 L 24 34 Z" fill="currentColor" />
                <path d="M 36 14 V 34" strokeWidth="2.5" />
                <path d="M 36 24 H 64" />
                <path d="M 28 14 L 34 8 M 32 8 H 34 V 10" strokeWidth="1" />
                <path d="M 32 18 L 38 12 M 36 12 H 38 V 14" strokeWidth="1" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">LED</span>
          </div>

          {/* 555 Timer */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'timer555')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform">
              <div className="border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-[9px] font-bold text-slate-700 dark:text-slate-300">NE555</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">555 Timer</span>
          </div>

          {/* Microcontroller */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'mcu')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform">
              <div className="border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-[9px] font-bold text-slate-700 dark:text-slate-300">MCU</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">MCU</span>
          </div>

          {/* Op-Amp */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'opamp')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="28" height="22" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="10,10 10,90 90,50" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Op-Amp</span>
          </div>

          {/* Multimeter */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'multimeter')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform">
              <div className="border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 font-mono text-[8px] text-slate-700 dark:text-slate-300">0.00 V</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Multimeter</span>
          </div>

          {/* DC Source */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'voltage', '5V')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="16" />
                <path d="M 24 13 V 19" />
                <path d="M 21 16 H 27" />
                <path d="M 21 32 H 27" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">DC Source</span>
          </div>

          {/* AC Source */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'acvoltage', '10V 60Hz')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="16" />
                <path d="M 16 24 C 18 16, 22 16, 24 24 C 26 32, 30 32, 32 24" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">AC Source</span>
          </div>

          {/* Signal Gen */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'signalgen')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform">
              <div className="border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 text-[8px] font-bold text-slate-700 dark:text-slate-300">~ SINE</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Signal Gen</span>
          </div>

          {/* Oscilloscope */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'scope')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform">
              <div className="border border-slate-300 dark:border-slate-700 rounded w-10 h-6 flex items-center justify-center overflow-hidden">
                <svg width="100%" height="100%" viewBox="0 0 100 60" className="text-slate-700 dark:text-slate-300">
                  <polyline points="0,30 25,10 50,50 75,10 100,30" fill="none" stroke="currentColor" strokeWidth="4" />
                </svg>
              </div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Scope</span>
          </div>

          {/* Speaker */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'speaker')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Speaker</span>
          </div>

          {/* Mic */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'microphone')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Mic</span>
          </div>

          {/* Switch */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'switch')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="30" height="20" viewBox="0 0 40 30" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="10" cy="20" r="3" fill="currentColor" />
                <circle cx="30" cy="20" r="3" fill="currentColor" />
                <line x1="10" y1="20" x2="30" y2="5" stroke="currentColor" strokeLinecap="round" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Switch</span>
          </div>

          {/* Pot */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'potentiometer', '10k')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="30" height="20" viewBox="0 0 32 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="4" width="28" height="6" rx="1"/>
                <line x1="16" y1="0" x2="16" y2="5"/>
                <path d="M13,3 L16,0 L19,3"/>
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Pot</span>
          </div>

          {/* 7-Seg */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'sevenseg')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform">
              <div className="border border-slate-300 dark:border-slate-700 rounded w-6 h-6 flex items-center justify-center font-mono text-xs font-bold text-slate-700 dark:text-slate-300">8</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">7-Seg</span>
          </div>

          {/* I Source */}
          <div 
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center gap-1.5 cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/55 dark:hover:bg-slate-850/30 transition-all group text-center"
            onDragStart={(e) => onDragStart(e, 'currentsource', '10m')} draggable
          >
            <div className="mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="24" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="14" cy="14" r="12" />
                <line x1="14" y1="20" x2="14" y2="8" />
                <path d="M10,12 L14,8 L18,12" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">I Source</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

function PropertiesPanel({ selectedNode, setNodes, isSimulating, runSimulation, simLength }: { selectedNode: Node, setNodes: any, isSimulating: boolean, runSimulation: () => void, simLength: number }) {
  if (!selectedNode) return null;

  const updateData = (key: string, value: any) => {
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNode.id) return n;
      const newData = { ...n.data, [key]: value };
      
      // If label is edited, clear the "hardcoded" numeric overrides so SPICE parses the new label
      if (key === 'label') {
        const overrides = ['voltage', 'resistance', 'capacitance', 'inductance'];
        overrides.forEach(o => {
          if (o in newData) delete (newData as any)[o];
        });
      }
      
      return { ...n, data: newData };
    }));
    if (isSimulating) {
      setTimeout(runSimulation, 50);
    }
  };

  return (
    <aside className="fixed inset-y-0 right-0 w-64 glass-panel border-l border-slate-200 dark:border-slate-800 p-4 bg-white/95 dark:bg-slate-900/95 shadow-xl lg:shadow-none z-40 lg:relative lg:z-10 overflow-y-auto transition-colors">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-slate-700 dark:text-slate-200 text-xs uppercase tracking-wider">Properties</h2>
        <button 
          onClick={() => setNodes((nds: Node[]) => nds.map(n => ({ ...n, selected: false })))} 
          className="lg:hidden p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 dark:text-slate-400"
          title="Close Properties"
        >
          <X size={20} />
        </button>
      </div>
      <div className="text-[10px] text-slate-400 dark:text-slate-500 mb-4 font-mono">ID: {selectedNode.id}</div>
      
      {['resistor', 'capacitor', 'inductor', 'diode', 'zener', 'led', 'switch', 'voltage', 'acvoltage', 'currentsource'].includes(selectedNode.type || '') && (
        <div className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Orientation</label>
          <select 
            value={(selectedNode.data.orientation as string) || 'horizontal'} 
            onChange={e => updateData('orientation', e.target.value)} 
            className="w-full text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertical</option>
          </select>
        </div>
      )}
      
      {selectedNode.type === 'voltage' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Voltage (V)</label>
          <input type="text" value={(selectedNode.data.label as string) || '5V'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
        </div>
      )}
      {selectedNode.type === 'acvoltage' && (
        <>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Amplitude (V)</label>
            <input type="number" step="1" value={(selectedNode.data.amplitude as number) || 10} onChange={e => { updateData('amplitude', parseFloat(e.target.value)); updateData('label', `${e.target.value}V ${selectedNode.data.frequency || 60}Hz`); }} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Frequency (Hz)</label>
            <input type="number" step="1" value={(selectedNode.data.frequency as number) || 60} onChange={e => { updateData('frequency', parseFloat(e.target.value)); updateData('label', `${selectedNode.data.amplitude || 10}V ${e.target.value}Hz`); }} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
        </>
      )}
      {selectedNode.type === 'resistor' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Resistance (Ω)</label>
          <input type="text" value={(selectedNode.data.label as string) || '1k'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
        </div>
      )}
      {selectedNode.type === 'capacitor' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Capacitance</label>
          <input type="text" value={(selectedNode.data.label as string) || '10u'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
        </div>
      )}
      {selectedNode.type === 'inductor' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Inductance</label>
          <input type="text" value={(selectedNode.data.label as string) || '100u'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
        </div>
      )}
      {selectedNode.type === 'switch' && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-gray-700">State</label>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${(selectedNode.data.isOpen !== false) ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {(selectedNode.data.isOpen !== false) ? 'OPEN' : 'CLOSED'}
            </span>
          </div>
          <button 
            onClick={() => updateData('isOpen', selectedNode.data.isOpen === false)}
            className={`w-full py-2 rounded font-bold text-sm shadow-sm transition-all ${
              (selectedNode.data.isOpen !== false) 
                ? 'bg-green-500 hover:bg-green-600 text-white' 
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            {(selectedNode.data.isOpen !== false) ? 'Close Switch' : 'Open Switch'}
          </button>
        </div>
      )}
      {selectedNode.type === 'led' && (
        <>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Color (CSS)</label>
            <input type="text" value={(selectedNode.data.color as string) || 'red'} onChange={e => updateData('color', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Forward Voltage Drop (V)</label>
            <input type="number" step="0.1" value={(selectedNode.data.v_drop as number) || 2.0} onChange={e => updateData('v_drop', parseFloat(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Max Current (mA)</label>
            <input type="number" value={(selectedNode.data.max_current as number) || 20} onChange={e => updateData('max_current', parseInt(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
          {selectedNode.data.isExploded && (
            <button 
              onClick={() => { updateData('isExploded', false); updateData('brightness', 0); }}
              className="w-full mt-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-2 rounded shadow-sm text-sm"
            >
              Repair Component
            </button>
          )}
        </>
      )}
      {selectedNode.type === 'signalgen' && (
        <>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Waveform</label>
            <select value={(selectedNode.data.waveform as string) || 'sine'} onChange={e => updateData('waveform', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1">
              <option value="sine">Sine</option>
              <option value="square">Square</option>
            </select>
          </div>
          {selectedNode.data.waveform === 'square' && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Duty Cycle (%)</label>
              <input type="number" min="1" max="99" value={(selectedNode.data.dutyCycle as number) || 50} onChange={e => updateData('dutyCycle', parseInt(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
            </div>
          )}
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Frequency (Hz)</label>
            <input type="number" value={(selectedNode.data.frequency as number) || 1} onChange={e => updateData('frequency', parseInt(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Amplitude (V)</label>
            <input type="number" value={(selectedNode.data.amplitude as number) || 5} onChange={e => updateData('amplitude', parseInt(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
          {((selectedNode.data.frequency as number) > 10000 && simLength > 0.5) && (
            <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-800 flex items-start gap-2 shadow-sm animate-pulse">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>Warning: High frequency with long duration may slow down simulation or lock UI. Consider reducing duration below 0.5s.</span>
            </div>
          )}
        </>
      )}
      {selectedNode.type === 'mcu' && (
        <>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Code (JS)</label>
            <textarea 
              value={(selectedNode.data.code as string) ?? "pinMode('D0', 'OUTPUT');\nwhile(true) {\n  digitalWrite('D0', 1);\n  sleep(500);\n  digitalWrite('D0', 0);\n  sleep(500);\n}"} 
              onChange={e => updateData('code', e.target.value)} 
              className="w-full text-xs font-mono border border-gray-300 rounded px-2 py-1 h-48 whitespace-pre bg-gray-50" 
              spellCheck="false"
            />
          </div>
          {selectedNode.data.logs && (selectedNode.data.logs as string[]).length > 0 && (
            <div className="mb-3 flex flex-col">
              <label className="block text-xs font-medium text-gray-700 mb-1 uppercase tracking-wider">Serial Monitor</label>
              <div className="bg-gray-900 text-green-400 font-mono text-[10px] p-2 h-32 overflow-y-auto rounded shadow-inner whitespace-pre-wrap">
                {(selectedNode.data.logs as string[]).map((log, i) => <div key={i}>{log}</div>)}
              </div>
            </div>
          )}
        </>
      )}
      {(selectedNode.type === 'npn' || selectedNode.type === 'pnp') && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Current Gain (BF)</label>
          <input type="number" value={(selectedNode.data.bf as number) || 300} onChange={e => updateData('bf', parseInt(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
        </div>
      )}
      {(selectedNode.type === 'nmos' || selectedNode.type === 'pmos') && (
        <>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Threshold Voltage (VTO)</label>
            <input type="number" step="0.1" value={(selectedNode.data.vto as number) || (selectedNode.type === 'nmos' ? 2.0 : -2.0)} onChange={e => updateData('vto', parseFloat(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Transconductance (KP)</label>
            <input type="number" step="0.01" value={(selectedNode.data.kp as number) || (selectedNode.type === 'nmos' ? 0.05 : 0.02)} onChange={e => updateData('kp', parseFloat(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
        </>
      )}
      {selectedNode.type === 'diode' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Forward Voltage Drop (V)</label>
          <input type="number" step="0.1" value={(selectedNode.data.v_drop as number) || 0.7} onChange={e => updateData('v_drop', parseFloat(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          <div className="text-[10px] text-gray-400 mt-1">Silicon: 0.7V, Germanium: 0.3V</div>
        </div>
      )}
      {selectedNode.type === 'zener' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Breakdown Voltage (V)</label>
          <input type="text" value={(selectedNode.data.label as string) || '5.1V'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          <div className="text-[10px] text-gray-400 mt-1">Common: 3.3V, 5.1V, 12V</div>
        </div>
      )}
      {selectedNode.type === 'microphone' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Amplification (×)</label>
          <input type="number" step="10" min="1" max="1000" value={(selectedNode.data.amplification as number) ?? 100} onChange={e => updateData('amplification', parseInt(e.target.value) || 100)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          <div className="text-[10px] text-gray-400 mt-1">Output voltage = mic × 0.05V × gain</div>
        </div>
      )}
      {selectedNode.type === 'speaker' && (
        <>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Voltage Scale (V)</label>
            <input type="number" step="1" min="0.1" value={(selectedNode.data.voltageScale as number) ?? 5} onChange={e => updateData('voltageScale', parseFloat(e.target.value) || 5)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
            <div className="text-[10px] text-gray-400 mt-1">Full-scale voltage (±V maps to ±1.0 audio)</div>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <input type="checkbox" id="spk-ac" checked={!!selectedNode.data.acCouple} onChange={e => updateData('acCouple', e.target.checked)} />
            <label htmlFor="spk-ac" className="text-xs text-gray-700">AC Couple (remove DC offset)</label>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <input type="checkbox" id="spk-norm" checked={!!selectedNode.data.normalize} onChange={e => updateData('normalize', e.target.checked)} />
            <label htmlFor="spk-norm" className="text-xs text-gray-700">Auto-normalize volume</label>
          </div>
        </>
      )}
      {selectedNode.type === 'scope' && (
        <>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">V/div</label>
            <input type="number" step="0.1" min="0.01" value={(selectedNode.data.vDiv as number) ?? ''} onChange={e => updateData('vDiv', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Auto" className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
            <div className="text-[10px] text-gray-400 mt-0.5">Leave empty for auto-detect</div>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Time/div (ms)</label>
            <input type="number" step="0.1" min="0.001" value={(selectedNode.data.tDiv as number) ?? ''} onChange={e => updateData('tDiv', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Auto" className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
            <div className="text-[10px] text-gray-400 mt-0.5">Leave empty for auto-detect</div>
          </div>
          <div className="mb-3 flex items-center gap-2">
            <input type="checkbox" id="scope-fft" checked={!!selectedNode.data.showFFT} onChange={e => updateData('showFFT', e.target.checked)} />
            <label htmlFor="scope-fft" className="text-xs font-medium text-gray-700">FFT Mode (Frequency Spectrum)</label>
          </div>
        </>
      )}
      {selectedNode.type === 'multimeter' && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-gray-700">Display Mode</label>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${selectedNode.data.isRms ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
              {selectedNode.data.isRms ? 'RMS' : 'DC'}
            </span>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <input 
              type="checkbox" 
              id="mm-rms" 
              checked={!!selectedNode.data.isRms} 
              onChange={e => updateData('isRms', e.target.checked)} 
              className="cursor-pointer"
            />
            <label htmlFor="mm-rms" className="text-xs text-gray-700 select-none cursor-pointer">
              Show RMS Value (reduces fluctuations)
            </label>
          </div>
        </div>
      )}
      {selectedNode.type === 'potentiometer' && (
        <>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Total Resistance</label>
            <input type="text" value={(selectedNode.data.label as string) || '10k'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Wiper Position ({(selectedNode.data.position as number) ?? 50}%)</label>
            <input type="range" min="0" max="100" value={(selectedNode.data.position as number) ?? 50} onChange={e => updateData('position', parseInt(e.target.value))} className="w-full" />
          </div>
        </>
      )}
      {selectedNode.type === 'sevenseg' && (
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">Segments: a(top) b(TR) c(BR) d(bot) e(BL) f(TL) g(mid)</div>
          <div className="text-xs text-gray-500">Connect 5V through resistors to segment inputs. Common cathode → GND.</div>
        </div>
      )}
      {selectedNode.type === 'currentsource' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Current</label>
          <input type="text" value={(selectedNode.data.label as string) || '10m'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
          <div className="text-[10px] text-gray-400 mt-1">e.g. 10m = 10mA, 1 = 1A</div>
        </div>
      )}

      {/* Datasheet Section */}
      {selectedNode.type && datasheets[selectedNode.type] && (() => {
        const ds = datasheets[selectedNode.type];
        return (
          <details className="mt-4 border-t border-gray-100 pt-3">
            <summary className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider cursor-pointer hover:text-indigo-800 select-none">📋 Datasheet: {ds.title}</summary>
            <div className="mt-2 text-[11px] text-gray-600 space-y-2">
              <p>{ds.description}</p>
              {ds.formula && (
                <div className="bg-gray-50 rounded p-2 font-mono text-[10px] text-gray-800 whitespace-pre-wrap border border-gray-100">{ds.formula}</div>
              )}
              {ds.specs && (
                <ul className="list-disc list-inside space-y-0.5 text-[10px] text-gray-500">
                  {ds.specs.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
              {ds.truthTable && (
                <table className="w-full text-center text-[10px] border-collapse">
                  <thead><tr>{ds.truthTable[0].map((h, i) => <th key={i} className="border border-gray-200 px-2 py-0.5 bg-gray-50 font-bold">{h}</th>)}</tr></thead>
                  <tbody>{ds.truthTable.slice(1).map((row, ri) => <tr key={ri}>{row.map((c, ci) => <td key={ci} className="border border-gray-200 px-2 py-0.5">{c}</td>)}</tr>)}</tbody>
                </table>
              )}
            </div>
          </details>
        );
      })()}
    </aside>
  );
}

function FlowArea({ 
  nodes, edges, setNodes, onNodesChange, onEdgesChange, onConnect, onNodeClick,
  probeMode, onEdgeProbe
}: any) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      const label = event.dataTransfer.getData('application/reactflow-label');

      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `${type}-${nodeId++}`,
        type,
        position,
        data: { label, isOn: false },
      };

      setNodes((nds: Node[]) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes]
  );

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    if (probeMode && onEdgeProbe) {
      onEdgeProbe(edge.id, _);
    }
  }, [probeMode, onEdgeProbe]);

  return (
    <div className="flex-1 h-full" ref={reactFlowWrapper} style={probeMode ? { cursor: 'crosshair' } : undefined}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onEdgeClick={handleEdgeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{ type: 'aura' }}
        snapToGrid={true}
        snapGrid={[4, 4]}
        fitView
      >
        <Background color="#ccc" gap={8} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function ProbeTooltip({ probeData, isSimulating, onClose }: { probeData: any; isSimulating: boolean; onClose: () => void }) {
  const [currentVoltage, setCurrentVoltage] = useState(probeData.voltage);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  useEffect(() => {
    if (!probeData.history || !probeData.timePoints || probeData.history.length === 0) {
      setCurrentVoltage(probeData.voltage);
      setCurrentTimeMs(0);
      return;
    }

    if (!isSimulating) {
      setCurrentTimeMs(0);
      setCurrentVoltage(probeData.history[probeData.history.length - 1] ?? 0);
      return;
    }

    const times = probeData.timePoints;

    const unsubscribe = playbackTicker.subscribe((elapsedMs) => {
      setCurrentTimeMs(elapsedMs);

      // Find index corresponding to elapsedMs
      let idx = 0;
      for (let i = 0; i < times.length; i++) {
        if (times[i] >= elapsedMs) {
          idx = i;
          break;
        }
      }

      setCurrentVoltage(probeData.history[idx] ?? 0);
    });

    return unsubscribe;
  }, [probeData, isSimulating]);

  return (
    <div
      className="fixed z-[200] bg-slate-950/95 backdrop-blur-md text-white rounded-xl px-4 py-3 shadow-2xl border border-violet-500/40 text-xs font-mono pointer-events-auto animate-in fade-in duration-100 flex flex-col gap-2 min-w-[220px]"
      style={{ left: probeData.x + 12, top: probeData.y - 10 }}
      onClick={onClose}
    >
      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 gap-4">
        <span className="text-violet-300 font-bold">🔍 Probe</span>
        <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">Net: {probeData.netName}</span>
      </div>
      
      <div className="flex justify-between items-baseline gap-4 mt-0.5">
        <div className="text-slate-400 text-[10px]">Value:</div>
        <div className="text-base font-bold text-green-400">{currentVoltage.toFixed(4)} V</div>
      </div>

      {probeData.history && probeData.history.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-1 text-[9px] text-slate-400 border-t border-slate-800/50 pt-1.5 mt-0.5">
            <div>Max: <span className="text-red-400">{probeData.maxV?.toFixed(2)}V</span></div>
            <div>Min: <span className="text-blue-400">{probeData.minV?.toFixed(2)}V</span></div>
            <div>Avg: <span className="text-amber-400">{probeData.avgV?.toFixed(2)}V</span></div>
          </div>

          <div className="h-10 w-full bg-slate-900/60 rounded-lg p-1 border border-slate-800/30 overflow-hidden flex items-center justify-center mt-1 relative">
            {/* Sparkline */}
            {(() => {
              const pts = probeData.history || [];
              const min = probeData.minV ?? 0;
              const max = probeData.maxV ?? 0;
              const range = max - min;
              
              // Downsample
              const maxPoints = 80;
              let displayPts = pts;
              if (pts.length > maxPoints) {
                const factor = Math.ceil(pts.length / maxPoints);
                displayPts = pts.filter((_, i) => i % factor === 0);
              }
              
              if (displayPts.length === 0) return null;
              
              const width = 180;
              const height = 32;
              const padding = 2;
              
              const pointsString = displayPts.map((v, i) => {
                const x = padding + (i / (displayPts.length - 1)) * (width - 2 * padding);
                const y = range === 0 
                  ? height / 2 
                  : height - padding - ((v - min) / range) * (height - 2 * padding);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');

              // Calculate playhead x-coordinate
              const times = probeData.timePoints || [0, 1000];
              const duration = times[times.length - 1] || 1000;
              const playheadRatio = duration > 0 ? currentTimeMs / duration : 0;
              const playheadX = padding + playheadRatio * (width - 2 * padding);

              return (
                <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
                  <defs>
                    <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  {/* Area under curve */}
                  {range > 0 && (
                    <polygon
                      points={`${padding},${height - padding} ${pointsString} ${width - padding},${height - padding}`}
                      fill="url(#sparkline-grad)"
                    />
                  )}
                  {/* Sparkline path */}
                  <polyline
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={pointsString}
                  />
                  {/* Playhead line */}
                  <line 
                    x1={playheadX} 
                    y1={padding} 
                    x2={playheadX} 
                    y2={height - padding} 
                    stroke="#ef4444" 
                    strokeWidth="1.5" 
                    strokeDasharray="1 1"
                  />
                </svg>
              );
            })()}
          </div>
        </>
      )}
      <div className="text-[9px] text-slate-500 mt-1 text-center italic border-t border-slate-800/30 pt-1">click to dismiss</div>
    </div>
  );
}

export default function App() {
  // ── Initialise from localStorage ────────────────────────────────────────────
  const savedSettings = loadSettings();

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('circuit_dark_mode') === 'true';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('circuit_dark_mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('circuit_dark_mode', 'false');
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode(prev => !prev);

  const [nodes, setNodes] = useState<Node[]>(presets.basicBlink.nodes);
  const [edges, setEdges] = useState<Edge[]>(presets.basicBlink.edges);
  const [isSimulating, setIsSimulating] = useState(false);
  const [mcpActiveCount, setMcpActiveCount] = useState(0);
  const [isSpiceRunning, setIsSpiceRunning] = useState(false);
  const [simLength, setSimLength] = useState(savedSettings.simLength ?? 1.0);
  const [simResolution, setSimResolution] = useState<'normal' | 'high'>(savedSettings.simResolution ?? 'normal');
  const [selectedPreset, setSelectedPreset] = useState('basicBlink');
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showAICopilot, setShowAICopilot] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState('');
  const [showAura, setShowAura] = useState(savedSettings.showAura ?? false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  const [userPresets, setUserPresets] = useState<Record<string, CircuitPreset>>(() => loadUserPresets());
  const [probeMode, setProbeMode] = useState(false);
  const [probeData, setProbeData] = useState<{
    netName: string;
    voltage: number;
    history?: number[];
    timePoints?: number[];
    maxV?: number;
    minV?: number;
    avgV?: number;
    x: number;
    y: number;
  } | null>(null);
  const simResultRef = useRef<{ portToNet: Record<string, string>; result: any } | null>(null);

  // Scope resize handler — inject into every scope node's data
  const scopeResizeHandler = useCallback((nodeId: string, w: number, h: number) => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, width: w, height: h } } : n
    ));
  }, [setNodes]);

  // Inject onResize callback into scope nodes
  useEffect(() => {
    setNodes(nds => nds.map(n => {
      if (n.type === 'scope' && !n.data.onResize) {
        return { ...n, data: { ...n.data, onResize: (w: number, h: number) => scopeResizeHandler(n.id, w, h) } };
      }
      return n;
    }));
  }, [nodes.length, scopeResizeHandler, setNodes]);

  // Auto-close sidebar on small screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1024) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keep microphone nodes aware of the simulation duration
  useEffect(() => {
    setNodes(nds => {
      const hasMic = nds.some(n => n.type === 'microphone');
      if (!hasMic) return nds;
      return nds.map(n =>
        n.type === 'microphone' && n.data.simLength !== simLength
          ? { ...n, data: { ...n.data, simLength } }
          : n
      );
    });
  }, [simLength, setNodes]);

  // ── Auto-save settings ──────────────────────────────────────────────────────
  useEffect(() => { saveSettings({ showAura }); }, [showAura]);
  useEffect(() => { saveSettings({ simResolution }); }, [simResolution]);
  useEffect(() => {
    const t = setTimeout(() => saveSettings({ simLength }), 500);
    return () => clearTimeout(t);
  }, [simLength]);

  // Update edges when aura setting changes
  useEffect(() => {
    setEdges(eds => eds.map(e => ({
      ...e,
      type: showAura ? 'aura' : 'smoothstep'
    })));
  }, [showAura, setEdges]);

  // Sync isSimulating state to all nodes so they can gate animations
  useEffect(() => {
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, isSimulating }
    })));
  }, [isSimulating, setNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    []
  );



  const runSimulation = async (nodesOverride?: Node[]) => {
    try {
      const currentNodes = nodesOverride || nodes;
      setIsSpiceRunning(true);
      setIsSimulating(true);
      // Yield to allow React/browser to render the "SPICE Simulating" notice
      await new Promise(resolve => setTimeout(resolve, 50));

      let { netlist, portToNet, mcuLogs } = generateSpiceNetlist(currentNodes, edges, simLength, simResolution);
      
      const mcuNodes = currentNodes.filter(n => n.type === 'mcu');
      const needsTwoPass = mcuNodes.some(n => {
        const code = (n.data.code as string) || "pinMode('D0', 'OUTPUT');\nwhile(true) {\n  digitalWrite('D0', 1);\n  sleep(500);\n  digitalWrite('D0', 0);\n  sleep(500);\n}";
        return code.includes('Read');
      });

      let result = await runSimInWorker(netlist);

      const findGraphFromSim = (res: any, netName: string) => {
        if (!netName || !res) return null;
        const search = netName.toLowerCase();
        
        // Handle eecircuit-engine format
        if (res.variableNames && res.data && res.data.length > 0 && res.data[0].values) {
          const idx = res.variableNames.findIndex((v: string) => v.toLowerCase() === search || v.toLowerCase() === `v(${search})`);
          if (idx !== -1 && res.data[idx]) {
            return {
              name: res.variableNames[idx],
              timestamps_ms: res.data[0].values.map((t: number) => t * 1000), // Time is variable 0
              voltage_levels: res.data[idx].values
            };
          }
        }
        
        return null;
      };

      if (needsTwoPass) {
         const mcuWaveforms: any = {};
         for (const mcu of mcuNodes) {
           mcuWaveforms[mcu.id] = {};
           for (const pin of ['D0', 'D1', 'D2', 'D3', 'A0', 'A1']) {
             const net = portToNet[`${mcu.id}-${pin}`];
             const graph = findGraphFromSim(result, net);
             if (graph) {
               mcuWaveforms[mcu.id][pin] = graph.timestamps_ms.map((t: number, i: number) => ({
                 t, v: graph.voltage_levels[i]
               }));
             }
           }
         }
         
         const pass2 = generateSpiceNetlist(currentNodes, edges, simLength, simResolution, mcuWaveforms);
         netlist = pass2.netlist;
         portToNet = pass2.portToNet;
         mcuLogs = pass2.mcuLogs;
         result = await runSimInWorker(netlist);
      }
      
      const findGraph = (netName: string) => findGraphFromSim(result, netName);

      const updatedNodes = currentNodes.map(n => {
        let newNode = { ...n } as any;
        newNode.data = { ...newNode.data, isSimulating: true };
        
        const v1Net = portToNet[`${n.id}-in`] || portToNet[`${n.id}-pos`] || portToNet[`${n.id}-anode`] || portToNet[`${n.id}-c`];
        const v2Net = portToNet[`${n.id}-out`] || portToNet[`${n.id}-neg`] || portToNet[`${n.id}-gnd`] || portToNet[`${n.id}-cathode`] || portToNet[`${n.id}-e`];
        const v1G = findGraph(v1Net);
        const v2G = findGraph(v2Net) || (v1G ? { voltage_levels: new Array(v1G.voltage_levels.length).fill(0) } : null);
        
        if (v1G && v2G) {
          let R = 1000;
          if (n.type === 'resistor' || n.type === 'inductor') {
            const valStr = sanitizeSpiceValue(String(n.data.label || (n.type === 'resistor' ? '1k' : '100u')));
            R = parseFloat(valStr) || 1000;
            const suffix = valStr.slice(-1).toLowerCase();
            if (suffix === 'k') R *= 1000;
            if (suffix === 'u') R /= 1000000;
            if (suffix === 'm' && valStr.slice(-2).toLowerCase() !== 'me') R /= 1000;
          } else if (n.type === 'switch') {
            const isOpen = n.data.isOpen !== false;
            R = isOpen ? 1e12 : 0.01; 
          } else if (n.type === 'led' || n.type === 'diode') {
            R = 100;
          } else if (n.type === 'npn' || n.type === 'pnp') {
            R = 50;
          }
          const curArr = v1G.voltage_levels.map((v, i) => Math.abs(v - (v2G.voltage_levels[i] || 0)) / (R || 1));
          newNode.data = { ...newNode.data, current_array: curArr, time_points: v1G.timestamps_ms };
        }

        // 2. Component-specific logic
        if (n.type === 'led') {
          const intNet = `int_led_${n.id}`;
          const anodeGraph = findGraph(portToNet[`${n.id}-anode`]);
          const intGraph = findGraph(intNet);
          let brightness = 0;
          let isExploded = !!n.data.isExploded;
          if (!isExploded && anodeGraph && intGraph) {
            const curArray = [];
            let maxI = 0;
            for (let i = 0; i < anodeGraph.timestamps_ms.length; i++) {
              const I = Math.abs(anodeGraph.voltage_levels[i] - intGraph.voltage_levels[i]); 
              curArray.push(I);
              if (I > maxI) maxI = I;
            }
            const max_allowed = Number(n.data.max_current || 20) / 1000;
            if (maxI > max_allowed * 1.5) isExploded = true;
            else if (maxI > 0.0005) brightness = Math.min(1, maxI / max_allowed);
            newNode.data = { ...newNode.data, brightness, isExploded, current_array: curArray, time_points: anodeGraph.timestamps_ms };
          }
        } else if (n.type === 'multimeter') {
          const vPos = findGraph(portToNet[`${n.id}-pos`]);
          const vNeg = findGraph(portToNet[`${n.id}-neg`]);
          const valPos = vPos ? vPos.voltage_levels[vPos.voltage_levels.length - 1] : 0;
          const valNeg = vNeg ? vNeg.voltage_levels[vNeg.voltage_levels.length - 1] : 0;
          const timePoints = vPos ? vPos.timestamps_ms : (vNeg ? vNeg.timestamps_ms : null);
          const vArr = vPos && vNeg 
            ? vPos.voltage_levels.map((v, i) => v - (vNeg.voltage_levels[i] || 0))
            : (vPos ? vPos.voltage_levels : (vNeg ? vNeg.voltage_levels.map(v => -v) : null));
          newNode.data = { 
            ...newNode.data, 
            voltage: valPos - valNeg,
            voltage_array: vArr,
            time_points: timePoints
          };
        } else if (n.type === 'scope') {
          const ch1 = findGraph(portToNet[`${n.id}-ch1`]);
          const ch2 = findGraph(portToNet[`${n.id}-ch2`]);
          const gnd = findGraph(portToNet[`${n.id}-gnd`]);
          let vd1: any[] = [];
          let vd2: any[] = [];
          if (ch1) vd1 = ch1.timestamps_ms.map((t, i) => ({ t, v: ch1.voltage_levels[i] - (gnd ? gnd.voltage_levels[i] : 0) }));
          if (ch2) vd2 = ch2.timestamps_ms.map((t, i) => ({ t, v: ch2.voltage_levels[i] - (gnd ? gnd.voltage_levels[i] : 0) }));
          newNode.data = { ...newNode.data, voltageData1: vd1, voltageData2: vd2 };
        } else if (n.type === 'speaker') {
          const graph = findGraph(portToNet[`${n.id}-in`]);
          const gnd = findGraph(portToNet[`${n.id}-gnd`]);
          let vd: any[] = [];
          if (graph) vd = graph.timestamps_ms.map((t, i) => ({ t, v: graph.voltage_levels[i] - (gnd ? gnd.voltage_levels[i] : 0) }));
          newNode.data = { ...newNode.data, voltageData: vd };
        } else if (n.type === 'mcu') {
          newNode.data.logs = mcuLogs[n.id];
        } else if (n.type === 'sevenseg') {
          const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
          const commonGraph = findGraph(portToNet[`${n.id}-common`]);
          const segmentVoltages: Record<string, number> = {};
          const segmentVoltageArrays: Record<string, number[]> = {};
          let timePoints: number[] = [];
          
          segs.forEach(s => {
            const segGraph = findGraph(portToNet[`${n.id}-${s}`]);
            if (segGraph) {
              if (timePoints.length === 0) timePoints = segGraph.timestamps_ms;
              const vComArr = commonGraph ? commonGraph.voltage_levels : new Array(segGraph.voltage_levels.length).fill(0);
              const diffs = segGraph.voltage_levels.map((v, i) => v - (vComArr[i] || 0));
              segmentVoltageArrays[s] = diffs;
              
              let peak = 0;
              diffs.forEach(d => { if (Math.abs(d) > Math.abs(peak)) peak = d; });
              segmentVoltages[s] = peak;
            } else {
              segmentVoltages[s] = 0;
              segmentVoltageArrays[s] = [];
            }
          });
          newNode.data = { ...newNode.data, segmentVoltages, segmentVoltageArrays, timePoints };
        }
        
        return newNode;
      });

      setNodes(updatedNodes);
      simResultRef.current = { portToNet, result };

      const updatedEdges = edges.map(e => {
        const srcNode = updatedNodes.find(n => n.id === e.source);
        const tgtNode = updatedNodes.find(n => n.id === e.target);
        let curArr = srcNode?.data.current_array || tgtNode?.data.current_array;
        let tPts = srcNode?.data.time_points || tgtNode?.data.time_points;
        
        if (!curArr) {
          const netName = portToNet[`${e.target}-${e.targetHandle}`] || portToNet[`${e.source}-${e.sourceHandle}`];
          const vG = findGraphFromSim(result, netName);
          if (vG) {
            // Virtual current based on 10k virtual input impedance to animate logic signals
            curArr = vG.voltage_levels.map((v: number) => Math.abs(v) / 10000);
            tPts = vG.timestamps_ms;
          }
        }

        return { 
          ...e, 
          type: showAura ? 'aura' : 'smoothstep', 
          data: { ...e.data, current_array: curArr, time_points: tPts } 
        };
      });
      setEdges(updatedEdges);
      setIsSpiceRunning(false);
      playbackTicker.start(simLength * 1000);
      
      return {
        ok: true,
        nodes: updatedNodes,
        edges: updatedEdges,
        rawResult: result
      };
      
    } catch (e: any) {
      console.error("Simulation failed:", e);
      setIsSpiceRunning(false);
      setIsSimulating(false);
      return { ok: false, error: e.message || String(e) };
    }
  };

  const stopSimulation = () => {
    setIsSimulating(false);
    playbackTicker.stop();
    setProbeData(null);
    setNodes(nds => nds.map(n => {
      if (n.type === 'led') {
        return { ...n, data: { ...n.data, brightness: 0, current_array: undefined, time_points: undefined } };
      }
      if (n.type === 'speaker' || n.type === 'scope') {
        return { ...n, data: { ...n.data, voltageData: undefined } };
      }
      return n;
    }));
    setEdges(eds => eds.map(e => ({ 
      ...e, 
      className: '', 
      animated: false,
      data: { ...e.data, current_array: undefined, time_points: undefined }
    })));
  };

  const onNodeClick = useCallback((_: any, node: Node) => {
    if (node.type === 'switch') {
      setNodes((nds) => {
        const nextNodes = nds.map((n) => {
          if (n.id === node.id) {
            return { ...n, data: { ...n.data, isOpen: n.data.isOpen === false } };
          }
          return n;
        });
        
        // Auto-re-trigger simulation with the NEW state
        if (isSimulating) {
          setTimeout(() => runSimulation(nextNodes), 50);
        }
        return nextNodes;
      });
    }
  }, [setNodes, runSimulation, isSimulating]);

  const deleteSelected = () => {
    setNodes(nds => nds.filter(n => !n.selected));
    setEdges(eds => eds.filter(e => !e.selected));
  };

  // ── Merged preset map (built-in + user) ────────────────────────────────────
  const allPresets: Record<string, CircuitPreset> = { ...presets, ...userPresets };

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value;
    setSelectedPreset(key);
    const preset = allPresets[key];
    if (preset) {
      stopSimulation();
      setNodes(preset.nodes);
      setEdges(preset.edges);
      if (preset.recommendedSimLength) {
        setSimLength(preset.recommendedSimLength);
      }
    }
  };

  // ── Save current circuit as user preset ────────────────────────────────────
  const handleSavePreset = () => {
    const trimmed = saveDialogName.trim();
    if (!trimmed) return;
    const key = nameToKey(trimmed);
    const preset: CircuitPreset = {
      name: `User: ${trimmed}`,
      nodes: nodes.map(n => ({ ...n, selected: false })),
      edges: edges.map(e => ({ ...e, data: undefined })),
    };
    const updated = addUserPreset(key, preset);
    setUserPresets(updated);
    setSelectedPreset(key);
    setIsSaveDialogOpen(false);
    setSaveDialogName('');
  };

  const handleDeleteUserPreset = (key: string) => {
    const updated = removeUserPreset(key);
    setUserPresets(updated);
    if (selectedPreset === key) {
      setSelectedPreset('basicBlink');
      setNodes(presets.basicBlink.nodes);
      setEdges(presets.basicBlink.edges);
    }
  };

  useMCPBridge({
    nodes, edges, isSimulating, selectedPreset, probeMode,
    runSimulation, stopSimulation,
    setProbeMode,
    setNodes: (n: any) => setNodes(n),
    setEdges: (e: any) => setEdges(e),
    loadPreset: (name: string) => {
      const preset = allPresets[name];
      if (preset) {
        stopSimulation();
        setNodes(preset.nodes);
        setEdges(preset.edges);
        setSelectedPreset(name);
      }
    },
    onTransactionStart: () => setMcpActiveCount(prev => prev + 1),
    onTransactionEnd: () => setMcpActiveCount(prev => Math.max(0, prev - 1)),
  });

  return (
    <div className={`flex flex-col h-screen w-full transition-colors duration-200 ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans overflow-hidden`}>
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 md:px-6 py-1.5 flex items-center justify-between shadow-xs z-10 transition-colors">
        <div className="flex items-center gap-2 md:gap-4">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-md lg:hidden text-slate-650 dark:text-slate-400 cursor-pointer"
            title="Toggle Menu"
          >
            <Menu size={20} />
          </button>
          <a 
            href="https://circuit.expt.in" 
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <Logo />
            <h1 className="font-bold text-base tracking-wide hidden sm:block mr-1 text-slate-800 dark:text-slate-100">
              PhysBox<span className="text-blue-500">: Volt</span>
            </h1>
          </a>
          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden lg:block"></div>
          
          {/* Preset Selector */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/60 shadow-inner">
            <select
              value={selectedPreset}
              onChange={handlePresetChange}
              className="bg-transparent text-slate-700 dark:text-slate-100 text-xs rounded-md block px-2 py-1 outline-none font-medium cursor-pointer border-none"
            >
              <optgroup label="⬜ Built-in Presets" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">
                {Object.keys(presets).map(key => (
                  <option key={key} value={key} className="bg-white dark:bg-slate-900 text-slate-750 dark:text-slate-350">{presets[key].name}</option>
                ))}
              </optgroup>
              {Object.keys(userPresets).length > 0 && (
                <optgroup label="📁 Saved Presets" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">
                  {Object.keys(userPresets).map(key => (
                    <option key={key} value={key} className="bg-white dark:bg-slate-900 text-slate-750 dark:text-slate-350">💾 {userPresets[key].name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {selectedPreset && userPresets[selectedPreset] && (
              <button
                onClick={() => {
                  if (window.confirm(`Are you sure you want to delete the preset "${userPresets[selectedPreset].name}"?`)) {
                    handleDeleteUserPreset(selectedPreset);
                  }
                }}
                className="flex items-center justify-center p-1 rounded-md text-red-500 hover:bg-red-55 dark:hover:bg-red-950/50 transition-colors focus:outline-none cursor-pointer"
                title={`Delete preset "${userPresets[selectedPreset].name}"`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1 md:gap-2">
          {/* Duration Block */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/60 shadow-inner hidden xl:flex">
            <span className="text-xs font-semibold text-slate-755 dark:text-slate-350 px-1.5">Duration:</span>
            <input 
              type="number" 
              min="0.1" 
              step="0.1" 
              value={simLength} 
              onChange={e => setSimLength(parseFloat(e.target.value) || 1.0)} 
              className="w-12 text-xs border-none bg-transparent focus:ring-0 text-center text-slate-800 dark:text-slate-100 font-medium"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400 mr-1.5">s</span>
          </div>

          {/* Resolution Block */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/60 shadow-inner mx-1 hidden 2xl:flex">
            <span className="text-xs font-semibold text-slate-755 dark:text-slate-350 px-1.5">Res:</span>
            <select
              value={simResolution}
              onChange={e => setSimResolution(e.target.value as 'normal' | 'high')}
              className="bg-transparent border-none text-slate-850 dark:text-slate-100 text-xs focus:ring-0 font-medium cursor-pointer"
            >
              <option value="normal" className="bg-white dark:bg-slate-900 text-slate-750 dark:text-slate-355">Normal</option>
              <option value="high" className="bg-white dark:bg-slate-900 text-slate-750 dark:text-slate-355">High</option>
            </select>
          </div>
          
          {/* Action Buttons */}
          <button 
            onClick={deleteSelected}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md font-semibold text-xs border border-slate-200 dark:border-slate-750 text-red-650 dark:text-red-400 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs"
            title="Delete Selected"
          >
            <Trash2 className="w-3.5 h-3.5" /> <span className="hidden xl:inline">Delete</span>
          </button>
          
          <button
            onClick={() => { setProbeMode(!probeMode); setProbeData(null); }}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md font-semibold text-xs border transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs ${
              probeMode 
                ? 'bg-violet-600 border-violet-650 text-white shadow-xs' 
                : 'border-slate-200 dark:border-slate-750 text-slate-650 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            title="Probe Mode — click a wire to inspect voltage"
          >
            <Crosshair className="w-3.5 h-3.5" /> <span className="hidden xl:inline">Probe</span>
          </button>

          {/* Simulation Controller Block */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/60 shadow-inner">
            <button 
              onClick={() => runSimulation()}
              disabled={isSimulating}
              className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-md font-semibold text-xs transition-all disabled:opacity-50 flex-shrink-0 cursor-pointer ${
                isSimulating
                  ? 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-xs'
              }`}
              title="Simulate"
            >
              <Play className="w-3 h-3" />
              <span className="hidden md:inline">Run</span>
            </button>

            <button 
              onClick={stopSimulation}
              disabled={!isSimulating}
              className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-md font-semibold text-xs transition-all disabled:opacity-50 flex-shrink-0 cursor-pointer ${
                isSimulating
                  ? 'bg-red-500 hover:bg-red-650 text-white shadow-xs'
                  : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-650 dark:text-slate-455'
              }`}
              title="Stop"
            >
              <Square className="w-3 h-3" />
              <span className="hidden md:inline">Stop</span>
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 mx-0.5 hidden sm:block" />

          {/* Right Utilities (Dark Mode, Docs, Settings, Copilot, GitHub) */}
          {/* Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs"
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />}
          </button>

          {/* Docs (Info) */}
          <button
            onClick={() => setIsDocsOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-indigo-200 dark:border-indigo-850 text-indigo-655 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs"
            title="Documentation"
          >
            <Info className="w-4 h-4" />
          </button>

          {/* Save Preset */}
          <button
            onClick={() => { setSaveDialogName(''); setIsSaveDialogOpen(true); }}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-amber-200 dark:border-amber-850 text-amber-655 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs"
            title="Save circuit as preset"
          >
            <Save className="w-4 h-4" />
          </button>

          {/* Settings */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className={`flex items-center justify-center w-8 h-8 rounded-full border transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs ${
              isSettingsOpen 
                ? 'bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-955 dark:border-blue-700 dark:text-blue-400' 
                : 'border-slate-200 dark:border-slate-700 text-slate-650 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* AI Copilot Expert */}
          <button
            onClick={() => setShowAICopilot(!showAICopilot)}
            className={`flex items-center justify-center w-8 h-8 rounded-full border transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs ${
              showAICopilot 
                ? 'bg-purple-100 border-purple-400 text-purple-750 dark:bg-purple-955 dark:border-purple-700 dark:text-purple-400' 
                : 'border-purple-200 dark:border-purple-800 text-purple-655 dark:text-purple-450 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-900/40'
            }`}
            title="AI Copilot Expert"
          >
            <Sparkles className="w-4 h-4" />
          </button>

          {/* GitHub link */}
          <a
            href="https://github.com/physbox-io/circuitsim"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs"
            title="View on GitHub"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
          </a>
        </div>
      </header>

      <div className="flex flex-1 relative min-h-0 overflow-hidden">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
        
        {/* Floating Status Indicators */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 flex flex-col gap-2 pointer-events-none items-center">
          {isSpiceRunning && (
            <div className="bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800/80 px-3.5 py-1.5 rounded-full shadow-md flex items-center gap-2.5 text-xs font-semibold backdrop-blur-md transition-all duration-300 pointer-events-auto">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </div>
              <Activity className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
              <span className="tracking-wide">SPICE Simulating</span>
            </div>
          )}
          {mcpActiveCount > 0 && (
            <div className="bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800/80 px-3.5 py-1.5 rounded-full shadow-md flex items-center gap-2.5 text-xs font-semibold backdrop-blur-md transition-all duration-300 pointer-events-auto">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </div>
              <Zap className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
              <span className="tracking-wide">MCP Active</span>
            </div>
          )}
        </div>

        <EdgePathProvider edges={edges}>
          <ReactFlowProvider>
            <FlowArea 
            nodes={nodes} edges={edges} 
            setNodes={setNodes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={onNodeClick}
            probeMode={probeMode}
            onEdgeProbe={(edgeId: string, event: React.MouseEvent) => {
              if (!probeMode || !simResultRef.current) return;
              const { portToNet, result } = simResultRef.current;
              const edge = edges.find(e => e.id === edgeId);
              if (!edge) return;
              const srcPort = `${edge.source}-${edge.sourceHandle || 'out'}`;
              const netName = portToNet[srcPort] || 'unknown';
              // Find voltage
              let voltage = 0;
              let history: number[] = [];
              let timePoints: number[] = [];
              let maxV = 0;
              let minV = 0;
              let avgV = 0;
              if (result?.variableNames && result?.data) {
                const search = netName.toLowerCase();
                const idx = result.variableNames.findIndex((v: string) => v.toLowerCase() === search || v.toLowerCase() === `v(${search})`);
                if (idx !== -1 && result.data[idx]) {
                  const vals = result.data[idx].values;
                  voltage = vals[vals.length - 1];
                  history = vals;
                  maxV = Math.max(...vals);
                  minV = Math.min(...vals);
                  const sum = vals.reduce((a: number, b: number) => a + b, 0);
                  avgV = sum / vals.length;
                  
                  if (result.data[0]) {
                    timePoints = result.data[0].values.map((t: number) => t * 1000);
                  }
                }
              }
              setProbeData({ netName, voltage, history, timePoints, maxV, minV, avgV, x: event.clientX, y: event.clientY });
            }}
          />
        </ReactFlowProvider>
      </EdgePathProvider>
        {nodes.find(n => n.selected) && (
          <PropertiesPanel 
            selectedNode={nodes.find(n => n.selected)!} 
            setNodes={setNodes} 
            isSimulating={isSimulating} 
            runSimulation={runSimulation}
            simLength={simLength}
          />
        )}
        {showAICopilot && (
          <AICopilotPanel
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            setEdges={setEdges}
            onClose={() => setShowAICopilot(false)}
          />
        )}
        {isDocsOpen && <DocsModal onClose={() => setIsDocsOpen(false)} />}
        {isSettingsOpen && (
          <SettingsModal
            onClose={() => setIsSettingsOpen(false)}
            showAura={showAura}
            setShowAura={setShowAura}
            userPresets={userPresets}
            onDeleteUserPreset={handleDeleteUserPreset}
          />
        )}

        {/* Save Circuit Dialog */}
        {isSaveDialogOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-150 border border-slate-200 dark:border-slate-800">
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex items-center gap-2 text-white">
                <Save size={20} />
                <h2 className="text-lg font-bold tracking-tight">Save Circuit</h2>
              </div>
              <div className="p-6 space-y-4">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-350">Circuit Name</label>
                <input
                  type="text"
                  autoFocus
                  value={saveDialogName}
                  onChange={e => setSaveDialogName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') setIsSaveDialogOpen(false); }}
                  placeholder="My Awesome Circuit"
                  className="w-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500">Saved as <span className="font-mono font-semibold">User: {saveDialogName.trim() || '…'}</span> in the preset list.</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950/60 px-6 py-4 flex gap-3 justify-end border-t border-slate-100 dark:border-slate-800/60">
                <button
                  onClick={() => setIsSaveDialogOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-650 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePreset}
                  disabled={!saveDialogName.trim()}
                  className="bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 disabled:dark:bg-slate-800 text-white px-5 py-2 rounded-xl font-bold text-sm shadow-lg shadow-amber-200 dark:shadow-none transition-all active:scale-95 cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Probe Tooltip */}
        {probeData && (
          <ProbeTooltip probeData={probeData} isSimulating={isSimulating} onClose={() => setProbeData(null)} />
        )}
      </div>
    </div>
  );
}
