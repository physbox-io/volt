import { useEffect, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { X } from 'lucide-react';
import { ORIENTABLE_NODE_TYPES, ORIENTATION_HANDLE_REMAP } from '../utils/nodeGeometry';
import { getNodeDefaultName } from '../utils/nodeNaming';
import { datasheets } from '../utils/datasheets';
import { defaultPackageForType } from '../utils/pcbFootprints';
import { nodeRegistry } from './nodes/registry';

const ORIENTATION_SELECTABLE_TYPES = ['resistor', 'capacitor', 'inductor', 'diode', 'zener', 'led', 'switch', 'voltage', 'acvoltage', 'currentsource'];
const PASSIVE_NAMED_TYPES = ['resistor', 'capacitor', 'inductor'];

export function PropertiesPanel({ selectedNode, setNodes, setEdges, isSimulating, runSimulation, simLength }: { selectedNode: any, setNodes: any, setEdges: any, isSimulating: boolean, runSimulation: () => void, simLength: number }) {
  const simDebounceTimerRef = useRef<any>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const webcamIntervalRef = useRef<any>(null);
  const [isRecordingWebcam, setIsRecordingWebcam] = useState(false);
  const webcamRecordingDataRef = useRef<{ t: number; v: number }[]>([]);
  const webcamRecordingStartRef = useRef<number>(0);

  // Sync streamRef with stream state for unmount cleanup
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  const ldrId = (selectedNode?.type === 'ldr' || (selectedNode?.type === 'led' && selectedNode?.data.photodiodeMode)) ? selectedNode.id : null;
  const isWebcamActive = (selectedNode?.type === 'ldr' || (selectedNode?.type === 'led' && selectedNode?.data.photodiodeMode)) ? !!selectedNode.data.isWebcamActive : false;

  const updateData = (key: string, value: any) => {
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNode?.id) return n;
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

    if (key === 'orientation' && selectedNode && ORIENTABLE_NODE_TYPES.includes(selectedNode.type || '')) {
      const prevOrientation = selectedNode.data.orientation || 'horizontal';
      const newOrientation = value;
      const isPrevFlipped = prevOrientation === 'left' || prevOrientation === 'up';
      const isNewFlipped = newOrientation === 'left' || newOrientation === 'up';

      if (isPrevFlipped !== isNewFlipped) {
        setEdges((eds: Edge[]) => eds.map(e => {
          let updated = { ...e };
          let changed = false;
          if (e.source === selectedNode.id) {
            const sh = e.sourceHandle;
            if (sh && sh in ORIENTATION_HANDLE_REMAP) { updated.sourceHandle = ORIENTATION_HANDLE_REMAP[sh]; changed = true; }
          }
          if (e.target === selectedNode.id) {
            const th = e.targetHandle;
            if (th && th in ORIENTATION_HANDLE_REMAP) { updated.targetHandle = ORIENTATION_HANDLE_REMAP[th]; changed = true; }
          }
          return changed ? updated : e;
        }));
      }
    }

    if (isSimulating) {
      if (simDebounceTimerRef.current) {
        clearTimeout(simDebounceTimerRef.current);
      }
      simDebounceTimerRef.current = setTimeout(() => {
        runSimulation();
      }, 150);
    }
  };

  const startWebcam = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(mediaStream);
      if (selectedNode && !selectedNode.data.isWebcamActive) {
        updateData('isWebcamActive', true);
      }

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(e => console.error("Error playing video:", e));
        }

        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 30;
        const ctx = canvas.getContext('2d');

        webcamIntervalRef.current = setInterval(() => {
          if (videoRef.current && ctx) {
            try {
              ctx.drawImage(videoRef.current, 0, 0, 40, 30);
              const imgData = ctx.getImageData(0, 0, 40, 30);
              const data = imgData.data;
              const lumas: number[] = [];
              for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i+1];
                const b = data[i+2];
                const luma = 0.299 * r + 0.587 * g + 0.114 * b;
                lumas.push(luma);
              }
              lumas.sort((a, b) => b - a);
              const topCount = Math.max(1, Math.floor(lumas.length * 0.05));
              let topSum = 0;
              for (let i = 0; i < topCount; i++) {
                topSum += lumas[i];
              }
              const avgBrightness = (topSum / topCount) / 255;
              updateData('lightLevel', avgBrightness);
            } catch (err) {
              console.error("Error analyzing frame:", err);
            }
          }
        }, 100);
      }, 300);
    } catch (err) {
      console.error("Error accessing webcam:", err);
      alert("Failed to access webcam. Please check permissions.");
    }
  };

  const stopWebcam = () => {
    if (webcamIntervalRef.current) {
      clearInterval(webcamIntervalRef.current);
      webcamIntervalRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (selectedNode && selectedNode.data.isWebcamActive) {
      updateData('isWebcamActive', false);
    }
  };

  // Reactive Effect to handle webcam stream lifecycle matching selection & node state
  useEffect(() => {
    if (stream && (!ldrId || !isWebcamActive)) {
      stopWebcam();
    } else if (ldrId && isWebcamActive && !stream) {
      startWebcam();
    }
  }, [ldrId, isWebcamActive, stream]);

  // Unmount cleanup effect
  useEffect(() => {
    return () => {
      if (webcamIntervalRef.current) {
        clearInterval(webcamIntervalRef.current);
        webcamIntervalRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startRecordingWebcam = () => {
    webcamRecordingDataRef.current = [];
    webcamRecordingStartRef.current = Date.now();
    setIsRecordingWebcam(true);

    const recordInterval = setInterval(() => {
      const elapsed = (Date.now() - webcamRecordingStartRef.current) / 1000;
      const currentLight = selectedNode?.data.lightLevel ?? 0.5;
      webcamRecordingDataRef.current.push({ t: elapsed, v: currentLight });
    }, 33);

    const duration = Math.min(simLength, 5);
    setTimeout(() => {
      clearInterval(recordInterval);
      setIsRecordingWebcam(false);
      updateData('pwlData', webcamRecordingDataRef.current);
    }, duration * 1000);
  };

  if (!selectedNode) return null;

  const meta = nodeRegistry[selectedNode.type || ''];
  const TypeProperties = meta?.Properties;

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
      <div className="text-[10px] text-slate-400 dark:text-slate-500 mb-3 font-mono">ID: {selectedNode.id}</div>

      {/* PCB Package Footprint Selector */}
      <div className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
          <span>PCB Footprint Package</span>
          <span className="text-[10px] text-indigo-500 font-mono font-bold">CNC Milling</span>
        </label>
        <select
          value={
            (selectedNode.data?.packageId as string) ||
            defaultPackageForType(selectedNode.type) ||
            '0805'
          }
          onChange={e => updateData('packageId', e.target.value)}
          className="w-full text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
        >
          <optgroup label="Through-Hole (THT)">
            <option value="AXIAL-0.3">Axial Resistor/Diode (0.3" / 7.62mm pitch)</option>
            <option value="LED-5MM">Radial 5mm THT (LED / Capacitor)</option>
            <option value="DIP-8">DIP-8 IC Package</option>
            <option value="DIP-14">DIP-14 IC Package</option>
            <option value="DIP-16">DIP-16 IC Package</option>
            <option value="TO-220">TO-220 Power Package (Regulator / MOSFET)</option>
            <option value="TO-92">TO-92 Small Signal Transistor (BJT)</option>
            <option value="DIP-10">DIP-10 (7-Segment Display)</option>
            <option value="RADIAL-5MM">Radial 5mm (Electrolytic / LDR)</option>
            <option value="POT-3PIN">Potentiometer (3-Pin, 2.54mm)</option>
            <option value="TRANSFORMER-4P">Transformer (2 Primary / 2 Secondary)</option>
            <option value="TACT-4PIN">6x6mm Tactile Switch</option>
            <option value="HEADER-1x02">2-Pin Header (2.54mm pitch)</option>
            <option value="HEADER-1x03">3-Pin Header (2.54mm pitch)</option>
            <option value="HEADER-1x04">4-Pin Header (2.54mm pitch)</option>
            <option value="HEADER-1x06">6-Pin Header (2.54mm pitch)</option>
            <option value="HEADER-1x08">8-Pin Header (2.54mm pitch)</option>
            <option value="TERMINAL-2P">5.08mm Screw Terminal (2-Pin)</option>
            <option value="TERMINAL-3P">5.08mm Screw Terminal (3-Pin)</option>
          </optgroup>
          <optgroup label="Surface Mount (SMD)">
            <option value="0805">SMD 0805 Passive (2.0 x 1.25mm)</option>
            <option value="1206">SMD 1206 Passive (3.2 x 1.6mm)</option>
            <option value="SOIC-8">SOIC-8 Surface Mount IC</option>
            <option value="SOT-23">SOT-23 Surface Mount Transistor</option>
          </optgroup>
        </select>
      </div>

      {ORIENTATION_SELECTABLE_TYPES.includes(selectedNode.type || '') && (
        <div className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Orientation</label>
          <select
            value={(selectedNode.data.orientation as string) || 'horizontal'}
            onChange={e => updateData('orientation', e.target.value)}
            className="w-full text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-blue-500 focus:outline-none mb-2"
          >
            <option value="horizontal">Horizontal</option>
            {ORIENTABLE_NODE_TYPES.includes(selectedNode.type || '') && (
              <option value="left">Horizontal (Left)</option>
            )}
            <option value="vertical">Vertical</option>
            {ORIENTABLE_NODE_TYPES.includes(selectedNode.type || '') && (
              <option value="up">Vertical (Up)</option>
            )}
          </select>
          {ORIENTABLE_NODE_TYPES.includes(selectedNode.type || '') && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                id="node-flip"
                checked={['left', 'up'].includes((selectedNode.data.orientation as string) || 'horizontal')}
                onChange={e => {
                  const current = (selectedNode.data.orientation as string) || 'horizontal';
                  if (e.target.checked) {
                    if (current === 'horizontal') updateData('orientation', 'left');
                    if (current === 'vertical') updateData('orientation', 'up');
                  } else {
                    if (current === 'left') updateData('orientation', 'horizontal');
                    if (current === 'up') updateData('orientation', 'vertical');
                  }
                }}
                className="cursor-pointer"
              />
              <label htmlFor="node-flip" className="text-xs text-gray-750 dark:text-slate-300 select-none cursor-pointer">
                Flip Direction
              </label>
            </div>
          )}
        </div>
      )}

      {PASSIVE_NAMED_TYPES.includes(selectedNode.type || '') && (
        <div className="mb-3">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Name</label>
          <input
            type="text"
            value={selectedNode.data.name !== undefined ? selectedNode.data.name : getNodeDefaultName(selectedNode.id, selectedNode.type)}
            onChange={e => updateData('name', e.target.value)}
            className="w-full text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-blue-500 focus:outline-none"
          />
        </div>
      )}

      {TypeProperties && (
        <TypeProperties
          node={selectedNode}
          updateData={updateData}
          isSimulating={isSimulating}
          simLength={simLength}
          webcam={{ stream, videoRef, isRecordingWebcam, startRecordingWebcam }}
        />
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
