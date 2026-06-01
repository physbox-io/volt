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
import { Play, Square, Trash2, Info, Menu, X, AlertCircle, Settings, Save, Crosshair } from 'lucide-react';
import { Simulation } from 'eecircuit-engine';
import { presets } from './utils/presets';
import { AuraEdge } from './components/AuraEdge';
import { SettingsModal } from './components/SettingsModal';
import { loadSettings, saveSettings, loadUserPresets, addUserPreset, removeUserPreset, nameToKey, type CircuitPreset } from './utils/storage';
import { PotentiometerNode } from './components/nodes/PotentiometerNode';
import { SevenSegmentNode } from './components/nodes/SevenSegmentNode';
import { CurrentSourceNode } from './components/nodes/CurrentSourceNode';
import { datasheets } from './utils/datasheets';
import { useMCPBridge } from './hooks/useMCPBridge';

const edgeTypes = {
  aura: AuraEdge,
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

let engineInstance: any = null;
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
        className="fixed inset-0 bg-black/20 lg:hidden pointer-events-auto" 
        onClick={onClose}
      ></div>
      <div className="w-64 h-full bg-white border-r border-gray-200 p-4 flex flex-col gap-4 shadow-xl lg:shadow-sm z-50 relative overflow-y-auto pointer-events-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wider">Components</h2>
          <button onClick={onClose} className="lg:hidden p-1 hover:bg-gray-100 rounded text-gray-500">
            <X size={20} />
          </button>
        </div>
      
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-4">Transistors</div>
      <div className="grid grid-cols-2 gap-2">
        <div onDragStart={(event) => onDragStart(event, 'npn')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">NPN BJT</div>
        </div>
        <div onDragStart={(event) => onDragStart(event, 'pnp')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">PNP BJT</div>
        </div>
        <div onDragStart={(event) => onDragStart(event, 'nmos')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">NMOS</div>
        </div>
        <div onDragStart={(event) => onDragStart(event, 'pmos')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">PMOS</div>
        </div>
      </div>

      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-4">Logic Gates</div>
      <div className="grid grid-cols-2 gap-2">
        <div onDragStart={(event) => onDragStart(event, 'and')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">AND</div>
        </div>
        <div onDragStart={(event) => onDragStart(event, 'or')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">OR</div>
        </div>
        <div onDragStart={(event) => onDragStart(event, 'not')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">NOT</div>
        </div>
        <div onDragStart={(event) => onDragStart(event, 'nand')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">NAND</div>
        </div>
        <div onDragStart={(event) => onDragStart(event, 'nor')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">NOR</div>
        </div>
        <div onDragStart={(event) => onDragStart(event, 'xor')} draggable className="bg-white border-2 border-gray-300 p-2 rounded cursor-grab hover:border-blue-500 transition-colors text-center shadow-sm">
          <div className="text-xs font-medium">XOR</div>
        </div>
      </div>

      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-4">Tools</div>
      
      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'voltage', '5V')} draggable
      >
        <div className="bg-yellow-100 border-2 border-yellow-600 rounded-full w-10 h-10 flex items-center justify-center font-bold text-[10px]">5V</div>
        <span className="text-sm font-medium">DC Voltage</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'ground')} draggable
      >
        <div className="flex flex-col items-center">
          <div className="w-1 h-3 bg-green-500"></div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-700">
            <path d="M4 10h16 M7 14h10 M10 18h4" />
          </svg>
        </div>
        <span className="text-sm font-medium">Ground</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'resistor', '1k')} draggable
      >
        <div className="bg-white border-2 border-gray-800 rounded w-16 h-6 flex items-center justify-center text-[10px] font-bold">1kΩ</div>
        <span className="text-sm font-medium">Resistor</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'capacitor', '10u')} draggable
      >
        <div className="bg-white border-2 border-blue-800 rounded w-10 h-10 flex flex-col items-center justify-center gap-1">
          <div className="flex gap-1 h-4">
            <div className="w-[2px] bg-gray-800 h-full"></div>
            <div className="w-[2px] bg-gray-800 h-full"></div>
          </div>
          <span className="text-[8px] font-bold">10uF</span>
        </div>
        <span className="text-sm font-medium">Capacitor</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'inductor', '100u')} draggable
      >
        <div className="bg-white border-2 border-green-800 rounded w-16 h-10 flex flex-col items-center justify-center gap-1">
          <svg width="24" height="8" viewBox="0 0 32 12">
            <path d="M0,6 C4,0 8,12 12,6 C16,0 20,12 24,6 C28,0 32,12 36,6" fill="none" stroke="#065f46" strokeWidth="2" />
          </svg>
          <span className="text-[8px] font-bold">100uH</span>
        </div>
        <span className="text-sm font-medium">Inductor</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'diode')} draggable
      >
        <div className="w-10 h-10 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 6v12l8-6-8-6Z" fill="currentColor" />
            <path d="M16 6v12" />
          </svg>
        </div>
        <span className="text-sm font-medium">Diode</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'led')} draggable
      >
        <div className="bg-red-100 border-2 border-red-600 rounded-full w-8 h-8 flex items-center justify-center">
           <div className="w-4 h-4 bg-red-500 rounded-full"></div>
        </div>
        <span className="text-sm font-medium">LED</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'timer555')} draggable
      >
        <div className="bg-gray-800 border-2 border-gray-900 rounded w-16 h-10 flex items-center justify-center">
          <span className="text-white text-[10px] font-bold">NE555</span>
        </div>
        <span className="text-sm font-medium">555 Timer</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'mcu')} draggable
      >
        <div className="bg-gray-800 border-2 border-gray-900 rounded w-16 h-10 flex items-center justify-center">
          <span className="text-white text-[10px] font-bold">MCU</span>
        </div>
        <span className="text-sm font-medium">Microcontroller</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'opamp')} draggable
      >
        <div className="w-12 h-10 relative">
          <svg width="100%" height="100%" viewBox="0 0 100 100">
            <polygon points="10,10 10,90 90,50" fill="white" stroke="#1f2937" strokeWidth="4" />
          </svg>
        </div>
        <span className="text-sm font-medium">Op-Amp</span>
      </div>
      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'multimeter')} draggable
      >
        <div className="bg-gray-800 border-2 border-gray-900 rounded w-16 h-10 flex items-center justify-center">
          <span className="text-green-400 text-[10px] font-mono">0.00 V</span>
        </div>
        <span className="text-sm font-medium">Multimeter</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'voltage', '5V')} draggable
      >
        <div className="bg-white border-2 border-red-800 rounded-full w-10 h-10 flex flex-col items-center justify-center">
          <span className="text-[10px] font-bold">+</span>
          <span className="text-[10px] font-bold">-</span>
        </div>
        <span className="text-sm font-medium text-center">DC Source</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'acvoltage', '10V 60Hz')} draggable
      >
        <div className="bg-white border-2 border-red-800 rounded-full w-10 h-10 flex flex-col items-center justify-center">
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-800">
             <path d="M4 12 c 4 -8, 12 8, 16 0" />
           </svg>
        </div>
        <span className="text-sm font-medium text-center">AC Source</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'signalgen')} draggable
      >
        <div className="bg-blue-100 border-2 border-blue-600 rounded w-16 h-10 flex flex-col items-center justify-center">
          <span className="text-blue-900 text-[8px] font-bold">~ SINE</span>
        </div>
        <span className="text-sm font-medium">Signal Gen</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'scope')} draggable
      >
        <div className="bg-gray-800 border-2 border-gray-900 rounded w-16 h-10 flex items-center justify-center overflow-hidden">
          <svg width="100%" height="100%" viewBox="0 0 100 60">
            <polyline points="0,30 25,10 50,50 75,10 100,30" fill="none" stroke="#22c55e" strokeWidth="4" />
          </svg>
        </div>
        <span className="text-sm font-medium">Oscilloscope</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'speaker')} draggable
      >
        <div className="bg-gray-100 border-2 border-gray-400 rounded w-10 h-10 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          </svg>
        </div>
        <span className="text-sm font-medium">Speaker</span>
      </div>
      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'microphone')} draggable
      >
        <div className="bg-gray-100 border-2 border-gray-400 rounded w-10 h-10 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
        </div>
        <span className="text-sm font-medium">Mic</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'switch')} draggable
      >
        <div className="bg-gray-100 border-2 border-gray-400 rounded w-10 h-10 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 40 30" fill="none" stroke="currentColor" strokeWidth="3">
             <circle cx="10" cy="20" r="3" fill="currentColor" />
             <circle cx="30" cy="20" r="3" fill="currentColor" />
             <line x1="10" y1="20" x2="30" y2="5" stroke="currentColor" strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-sm font-medium">Switch</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'potentiometer', '10k')} draggable
      >
        <div className="bg-white border-2 border-orange-700 rounded w-16 h-8 flex items-center justify-center">
          <svg width="32" height="14" viewBox="0 0 32 14"><rect x="2" y="4" width="28" height="6" fill="none" stroke="#9a3412" strokeWidth="1.5" rx="1"/><line x1="16" y1="0" x2="16" y2="5" stroke="#c2410c" strokeWidth="1.5"/><path d="M13,3 L16,0 L19,3" fill="none" stroke="#c2410c" strokeWidth="1"/></svg>
        </div>
        <span className="text-sm font-medium">Pot</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'sevenseg')} draggable
      >
        <div className="bg-gray-900 border-2 border-gray-700 rounded w-10 h-10 flex items-center justify-center">
          <span className="text-red-500 font-bold text-lg font-mono">8</span>
        </div>
        <span className="text-sm font-medium">7-Seg</span>
      </div>

      <div 
        className="border border-gray-300 rounded p-3 cursor-grab hover:bg-gray-50 flex flex-col items-center gap-2"
        onDragStart={(e) => onDragStart(e, 'currentsource', '10m')} draggable
      >
        <div className="bg-white border-2 border-teal-700 rounded-full w-10 h-10 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 28 28" fill="none"><line x1="14" y1="24" x2="14" y2="6" stroke="#0d9488" strokeWidth="2"/><path d="M10,10 L14,4 L18,10" fill="none" stroke="#0d9488" strokeWidth="2"/></svg>
        </div>
        <span className="text-sm font-medium">I Source</span>
      </div>
    </div>
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
    <div className="fixed inset-y-0 right-0 w-64 bg-white border-l border-gray-200 p-4 shadow-xl lg:shadow-sm z-40 lg:relative lg:z-10 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wider">Properties</h2>
        <button 
          onClick={() => setNodes((nds: Node[]) => nds.map(n => ({ ...n, selected: false })))} 
          className="lg:hidden p-1 hover:bg-gray-100 rounded text-gray-500"
          title="Close Properties"
        >
          <X size={20} />
        </button>
      </div>
      <div className="text-xs text-gray-500 mb-4 font-mono">ID: {selectedNode.id}</div>
      
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
    </div>
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
        fitView
      >
        <Background color="#ccc" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function App() {
  // ── Initialise from localStorage ────────────────────────────────────────────
  const savedSettings = loadSettings();

  const [nodes, setNodes] = useState<Node[]>(presets.basicBlink.nodes);
  const [edges, setEdges] = useState<Edge[]>(presets.basicBlink.edges);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simLength, setSimLength] = useState(savedSettings.simLength ?? 1.0);
  const [simResolution, setSimResolution] = useState<'normal' | 'high'>(savedSettings.simResolution ?? 'normal');
  const [selectedPreset, setSelectedPreset] = useState('basicBlink');
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState('');
  const [showAura, setShowAura] = useState(savedSettings.showAura ?? false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  const [userPresets, setUserPresets] = useState<Record<string, CircuitPreset>>(() => loadUserPresets());
  const [probeMode, setProbeMode] = useState(false);
  const [probeData, setProbeData] = useState<{ netName: string; voltage: number; x: number; y: number } | null>(null);
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
      setIsSimulating(true);
      if (!engineInstance) {
        engineInstance = new Simulation();
        await engineInstance.start();
      }
      
      let { netlist, portToNet, mcuLogs } = generateSpiceNetlist(currentNodes, edges, simLength, simResolution);
      
      const mcuNodes = currentNodes.filter(n => n.type === 'mcu');
      const needsTwoPass = mcuNodes.some(n => {
        const code = (n.data.code as string) || "pinMode('D0', 'OUTPUT');\nwhile(true) {\n  digitalWrite('D0', 1);\n  sleep(500);\n  digitalWrite('D0', 0);\n  sleep(500);\n}";
        return code.includes('Read');
      });

      engineInstance.setNetList(netlist);
      let result = await engineInstance.runSim();

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
         engineInstance.setNetList(netlist);
         result = await engineInstance.runSim();
      }
      
      const findGraph = (netName: string) => findGraphFromSim(result, netName);

      const updatedNodes = currentNodes.map(n => {
        let newNode = { ...n } as any;
        newNode.data = { ...newNode.data, isSimulating: true };
        
        // 1. Calculate current_array for nodes with terminals
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
          newNode.data = { ...newNode.data, voltage: valPos - valNeg };
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
        const curArr = srcNode?.data.current_array || tgtNode?.data.current_array;
        const tPts = srcNode?.data.time_points || tgtNode?.data.time_points;
        return { 
          ...e, 
          type: showAura ? 'aura' : 'smoothstep', 
          data: { ...e.data, current_array: curArr, time_points: tPts } 
        };
      });
      setEdges(updatedEdges);
      
      return {
        ok: true,
        nodes: updatedNodes,
        edges: updatedEdges,
        rawResult: result
      };
      
    } catch (e: any) {
      console.error("Simulation failed:", e);
      setIsSimulating(false);
      return { ok: false, error: e.message || String(e) };
    }
  };

  const stopSimulation = () => {
    setIsSimulating(false);
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
  });

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 text-gray-900 font-sans overflow-hidden">
      <div className="bg-gradient-to-b from-slate-50 to-white border-b border-gray-200 px-3 md:px-6 py-1.5 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-2 md:gap-4">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-gray-100 rounded-md lg:hidden text-gray-600"
            title="Toggle Menu"
          >
            <Menu size={20} />
          </button>
          <a 
            href="https://circuit.expt.in" 
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <Logo />
            <h1 className="text-lg md:text-xl font-black text-indigo-600 tracking-tight hidden sm:block">Circuit Expt</h1>
          </a>
          <div className="h-6 w-px bg-gray-300 hidden lg:block"></div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-gray-600 hidden xl:block">Circuit:</span>
            <select
              value={selectedPreset}
              onChange={handlePresetChange}
              className="bg-gray-100 border border-gray-300 text-gray-900 text-xs md:text-sm rounded-md focus:ring-indigo-500 focus:border-indigo-500 block p-1 md:p-2 max-w-[100px] sm:max-w-none"
            >
              <optgroup label="Built-in">
                {Object.keys(presets).map(key => (
                  <option key={key} value={key}>{presets[key].name}</option>
                ))}
              </optgroup>
              {Object.keys(userPresets).length > 0 && (
                <optgroup label="My Circuits">
                  {Object.keys(userPresets).map(key => (
                    <option key={key} value={key}>{userPresets[key].name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>
        
        <div className="flex items-center gap-1 md:gap-2">
          <div className="flex items-center gap-1 bg-white px-1.5 py-1 rounded shadow-sm border border-gray-300 hidden xl:flex">
            <span className="text-xs font-semibold text-gray-700">Duration:</span>
            <input 
              type="number" 
              min="0.1" 
              step="0.1" 
              value={simLength} 
              onChange={e => setSimLength(parseFloat(e.target.value) || 1.0)} 
              className="w-12 text-xs border-none bg-transparent focus:ring-0 text-center"
            />
            <span className="text-xs text-gray-500 mr-1">s</span>
          </div>

          <div className="flex items-center gap-1 bg-white px-1.5 py-1 rounded shadow-sm border border-gray-300 mx-1 hidden 2xl:flex">
            <span className="text-xs font-semibold text-gray-700">Res:</span>
            <select
              value={simResolution}
              onChange={e => setSimResolution(e.target.value as 'normal' | 'high')}
              className="bg-transparent border-none text-gray-900 text-xs focus:ring-0"
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
          
          <button 
            onClick={deleteSelected}
            className="flex items-center justify-center bg-gray-500 hover:bg-gray-600 text-white p-2 rounded-md font-medium text-sm transition-colors"
            title="Delete Selected"
          >
            <Trash2 size={16} /> <span className="hidden 2xl:inline ml-2">Delete</span>
          </button>
          <button
            onClick={() => { setProbeMode(!probeMode); setProbeData(null); }}
            className={`flex items-center justify-center p-2 rounded-md font-medium text-sm transition-colors ${probeMode ? 'bg-violet-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
            title="Probe Mode — click a wire to inspect voltage"
          >
            <Crosshair size={16} /> <span className="hidden 2xl:inline ml-2">Probe</span>
          </button>
          <button 
            onClick={() => runSimulation()}
            disabled={isSimulating}
            className="flex items-center justify-center bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white p-2 md:px-4 md:py-2 rounded-md font-medium text-sm transition-colors"
            title="Simulate"
          >
            <Play size={16} /> <span className="hidden xl:inline ml-2">Simulate</span>
          </button>
          <button 
            onClick={stopSimulation}
            disabled={!isSimulating}
            className="flex items-center justify-center bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white p-2 md:px-4 md:py-2 rounded-md font-medium text-sm transition-colors"
            title="Stop"
          >
            <Square size={16} /> <span className="hidden xl:inline ml-2">Stop</span>
          </button>
          <button
            onClick={() => setIsDocsOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 transition-colors focus:outline-none flex-shrink-0"
            title="Documentation"
          >
            <Info size={18} />
          </button>
          <button
            onClick={() => { setSaveDialogName(''); setIsSaveDialogOpen(true); }}
            className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-amber-200 text-amber-600 hover:bg-amber-50 hover:border-amber-300 transition-colors focus:outline-none flex-shrink-0"
            title="Save circuit as preset"
          >
            <Save size={18} />
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors focus:outline-none flex-shrink-0"
            title="Settings"
          >
            <Settings size={18} />
          </button>
          <a
            href="https://github.com/tomgrek/circuitsim"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors focus:outline-none flex-shrink-0"
            title="View on GitHub"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
          </a>
        </div>
      </div>

      <div className="flex flex-1 relative min-h-0 overflow-hidden">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
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
              if (result?.variableNames && result?.data) {
                const search = netName.toLowerCase();
                const idx = result.variableNames.findIndex((v: string) => v.toLowerCase() === search || v.toLowerCase() === `v(${search})`);
                if (idx !== -1 && result.data[idx]) {
                  const vals = result.data[idx].values;
                  voltage = vals[vals.length - 1];
                }
              }
              setProbeData({ netName, voltage, x: event.clientX, y: event.clientY });
            }}
          />
        </ReactFlowProvider>
        {nodes.find(n => n.selected) && (
           <PropertiesPanel 
        selectedNode={nodes.find(n => n.selected)!} 
        setNodes={setNodes} 
        isSimulating={isSimulating} 
        runSimulation={runSimulation}
        simLength={simLength}
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
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex items-center gap-2 text-white">
                <Save size={20} />
                <h2 className="text-lg font-bold tracking-tight">Save Circuit</h2>
              </div>
              <div className="p-6 space-y-4">
                <label className="block text-sm font-semibold text-gray-700">Circuit Name</label>
                <input
                  type="text"
                  autoFocus
                  value={saveDialogName}
                  onChange={e => setSaveDialogName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') setIsSaveDialogOpen(false); }}
                  placeholder="My Awesome Circuit"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                />
                <p className="text-[11px] text-gray-400">Saved as <span className="font-mono font-semibold">User: {saveDialogName.trim() || '…'}</span> in the preset list.</p>
              </div>
              <div className="bg-gray-50 px-6 py-4 flex gap-3 justify-end">
                <button
                  onClick={() => setIsSaveDialogOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePreset}
                  disabled={!saveDialogName.trim()}
                  className="bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white px-5 py-2 rounded-xl font-bold text-sm shadow-lg shadow-amber-200 transition-all active:scale-95"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Probe Tooltip */}
        {probeData && (
          <div
            className="fixed z-[200] bg-gray-900 text-white rounded-lg px-4 py-3 shadow-2xl border border-violet-500 text-xs font-mono pointer-events-auto animate-in fade-in duration-100"
            style={{ left: probeData.x + 12, top: probeData.y - 10 }}
            onClick={() => setProbeData(null)}
          >
            <div className="text-violet-300 font-bold mb-1">🔍 Probe</div>
            <div>Net: <span className="text-amber-300">{probeData.netName}</span></div>
            <div>V: <span className="text-green-300">{probeData.voltage.toFixed(4)} V</span></div>
            <div className="text-[9px] text-gray-400 mt-1 italic">click to dismiss</div>
          </div>
        )}
      </div>
    </div>
  );
}
