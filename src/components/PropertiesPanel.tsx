import { useEffect, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { X, Trash2 } from 'lucide-react';
import { ORIENTABLE_NODE_TYPES, ORIENTATION_HANDLE_REMAP } from '../utils/nodeGeometry';
import { getNodeDefaultName } from '../utils/nodeNaming';
import { datasheets } from '../utils/datasheets';
import {
  defaultPackageForType,
  footprintFromParams,
  resolveFootprint,
  type FootprintParams,
} from '../utils/pcbFootprints';
import { minPadGapMm } from '../utils/pcbTooling';
import { nodeRegistry } from './nodes/registry';

const ORIENTATION_SELECTABLE_TYPES = ['resistor', 'capacitor', 'inductor', 'diode', 'zener', 'led', 'switch', 'voltage', 'acvoltage', 'currentsource'];
const PASSIVE_NAMED_TYPES = ['resistor', 'capacitor', 'inductor'];

/** Sentinel package id that switches the node over to `data.footprintParams`. */
const CUSTOM_PACKAGE_ID = 'CUSTOM-PARAMETRIC';

const FOOTPRINT_INPUT_CLASS =
  'w-full text-[11px] border border-gray-300 dark:border-slate-800 rounded px-1.5 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-indigo-500 focus:outline-none';

function FootprintField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="col-span-2 block">
      <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

/**
 * A blank box means "use the family default", which is why the value is held as
 * a string and only converted on a complete parse — typing "1." must not snap
 * the field back to 1.
 */
function FootprintNumber({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number | undefined;
  step: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        placeholder="auto"
        onChange={e => {
          const raw = e.target.value.trim();
          if (raw === '') return onChange(undefined);
          const n = parseFloat(raw);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
        className={FOOTPRINT_INPUT_CLASS}
      />
    </label>
  );
}

export function PropertiesPanel({ selectedNode, setNodes, setEdges, isSimulating, runSimulation, simLength, isOpen, onClose }: { selectedNode: any, setNodes: any, setEdges: any, isSimulating: boolean, runSimulation: () => void, simLength: number, /** Drawer state below `lg`; ignored at `lg`, where this is a column. */ isOpen?: boolean, onClose?: () => void }) {
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

  // --- PCB footprint ---------------------------------------------------
  const fp: FootprintParams = (selectedNode.data?.footprintParams as FootprintParams) ?? {};
  const showFootprintEditor =
    !!selectedNode.data?.footprintParams || selectedNode.data?.packageId === CUSTOM_PACKAGE_ID;

  const updateFootprintParam = (key: keyof FootprintParams, value: any) => {
    const next: FootprintParams = { ...fp, [key]: value };
    if (value === undefined) delete next[key];
    updateData('footprintParams', next);
  };

  // Preview and the fine-pitch warning both come from the same resolver the
  // exporter uses, so what the panel reports is what actually gets milled.
  let previewFootprint = null;
  try {
    previewFootprint = showFootprintEditor
      ? footprintFromParams(fp)
      : resolveFootprint(
          selectedNode.data?.packageId as string | undefined,
          selectedNode.type,
          (selectedNode.data?.pins as number) || 2,
          selectedNode.data
        );
  } catch {
    previewFootprint = null;
  }

  // 0.35mm is roughly what a 20-degree V-bit cuts at a workable depth; below
  // that the part needs a sharper bit than most people own.
  const isFineParametric =
    !!previewFootprint && minPadGapMm(previewFootprint.pads) < 0.35;

  return (
    /*
      `absolute`, not `fixed`, for the overlay below `lg`: pinned to the
      viewport it ran the full height of the screen, covering the header above
      and the status bar below it. Against the workspace it sits between them.
      At `lg` this is a permanent column (`lg:relative`), where neither applies.
    */
    <aside
      className={`absolute inset-y-0 right-0 w-64 max-lg:max-w-[80vw] glass-panel border-l border-slate-200 dark:border-slate-800 p-4 bg-white/95 dark:bg-slate-900/95 shadow-xl lg:shadow-none z-40 max-lg:z-[110] lg:relative lg:z-10 overflow-y-auto transition-colors max-lg:transition-transform max-lg:duration-200 ${
        // Below `lg` the drawer waits off the right-hand edge until it is asked
        // for. `pointer-events-none` as well as the translate, so that a panel
        // parked off screen cannot swallow taps meant for the canvas.
        isOpen ? 'max-lg:translate-x-0' : 'max-lg:translate-x-full max-lg:pointer-events-none'
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-slate-700 dark:text-slate-200 text-xs uppercase tracking-wider">Properties</h2>
        <div className="flex items-center gap-1">
          {/*
            Deleting a part is the bin in the top bar and the Delete key, and on
            a phone there is no Delete key and the drawer is covering the part
            the bin would act on. So the drawer carries its own bin, acting on
            the component it is showing — same edit as the top bar's, so undo
            treats it the same way.
          */}
          <button
            onClick={() => {
              setNodes((nds: Node[]) => nds.filter(n => n.id !== selectedNode.id));
              setEdges((eds: Edge[]) => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
            }}
            disabled={isSimulating}
            className="lg:hidden p-1 hover:bg-red-50 dark:hover:bg-red-950/40 rounded text-red-500 disabled:opacity-30 disabled:hover:bg-transparent"
            title={isSimulating ? 'Stop the simulation to edit the circuit.' : 'Delete this component'}
          >
            <Trash2 size={18} />
          </button>
          {/* Closes the drawer and leaves the component selected: the bar's
              bin, undo and the keyboard all act on the selection, so putting
              the panel away must not throw that away too. */}
          <button
            onClick={onClose}
            className="lg:hidden p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 dark:text-slate-400"
            title="Close Properties"
          >
            <X size={20} />
          </button>
        </div>
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
            showFootprintEditor
              ? CUSTOM_PACKAGE_ID
              : (selectedNode.data?.packageId as string) ||
                defaultPackageForType(selectedNode.type) ||
                '0805'
          }
          onChange={e => {
            const next = e.target.value;
            updateData('packageId', next);
            if (next === CUSTOM_PACKAGE_ID) {
              // Seed from whatever is currently resolved, so the editor opens
              // on the part's real dimensions rather than on empty boxes.
              if (!selectedNode.data?.footprintParams) {
                const seedLeft = Math.ceil((previewFootprint?.pads.length || 8) / 2);
                updateData('footprintParams', {
                  family: 'dual',
                  leftCount: seedLeft,
                  rightCount: (previewFootprint?.pads.length || 8) - seedLeft,
                  pitchMm: 2.54,
                  rowSpacingMm: 15.24,
                  drillDiaMm: 1.0,
                } as FootprintParams);
              }
            } else {
              updateData('footprintParams', undefined);
            }
          }}
          className="w-full text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
        >
          {selectedNode.type === 'mcu' && (
            <optgroup label="Microcontroller / Module Geometry">
              <option value={(selectedNode.data?.packageId as string) || 'MCU-PARAMETRIC'}>
                {(selectedNode.data?.packageId as string) || 'Parametric MCU / Board Module'}
              </option>
            </optgroup>
          )}
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
            <option value="CC1101">CC1101 RF Module (2x4 Dupont Header)</option>
            <option value="HELTEC-V4">Heltec WiFi LoRa 32 V4 (Dual Header Board)</option>
            <option value="HEADER-1x02">1x2 Pin Header (2.54mm pitch)</option>
            <option value="HEADER-1x03">1x3 Pin Header (2.54mm pitch)</option>
            <option value="HEADER-1x04">1x4 Pin Header (2.54mm pitch)</option>
            <option value="HEADER-1x06">1x6 Pin Header (2.54mm pitch)</option>
            <option value="HEADER-1x08">1x8 Pin Header (2.54mm pitch)</option>
            <option value="HEADER-2x02">2x2 Pin Dupont Header (2.54mm pitch)</option>
            <option value="HEADER-2x03">2x3 Pin Dupont Header (2.54mm pitch)</option>
            <option value="HEADER-2x04">2x4 Pin Dupont Header (2.54mm pitch)</option>
            <option value="HEADER-2x06">2x6 Pin Dupont Header (2.54mm pitch)</option>
            <option value="HEADER-2x08">2x8 Pin Dupont Header (2.54mm pitch)</option>
            <option value="TERMINAL-2P">5.08mm Screw Terminal (2-Pin)</option>
            <option value="TERMINAL-3P">5.08mm Screw Terminal (3-Pin)</option>
            <option value="DIP-18">DIP-18 IC Package</option>
            <option value="DIP-20">DIP-20 IC Package</option>
            <option value="DIP-24">DIP-24 (0.3" narrow)</option>
            <option value="DIP-24-W">DIP-24 (0.6" wide)</option>
            <option value="DIP-28">DIP-28 (0.3" narrow — ATmega328P)</option>
            <option value="DIP-28-W">DIP-28 (0.6" wide)</option>
            <option value="DIP-32-W">DIP-32 (0.6" wide)</option>
            <option value="DIP-40-W">DIP-40 (0.6" wide)</option>
            <option value="TO-247">TO-247 High Power Transistor</option>
          </optgroup>
          <optgroup label="Surface Mount — Passives &amp; Diodes">
            <option value="0402">SMD 0402 Passive (1.0 x 0.5mm)</option>
            <option value="0603">SMD 0603 Passive (1.6 x 0.8mm)</option>
            <option value="0805">SMD 0805 Passive (2.0 x 1.25mm)</option>
            <option value="1206">SMD 1206 Passive (3.2 x 1.6mm)</option>
            <option value="1210">SMD 1210 Passive (3.2 x 2.5mm)</option>
            <option value="2512">SMD 2512 Power Resistor (6.3 x 3.2mm)</option>
            <option value="SOD-123">SOD-123 Diode</option>
            <option value="SOD-323">SOD-323 Diode</option>
            <option value="SMA">SMA / DO-214AC Diode</option>
            <option value="SMB">SMB / DO-214AA Diode</option>
          </optgroup>
          <optgroup label="Surface Mount — Discrete">
            <option value="SOT-23">SOT-23 Transistor (3-Pin)</option>
            <option value="SOT-23-5">SOT-23-5</option>
            <option value="SOT-23-6">SOT-23-6</option>
            <option value="SOT-323">SOT-323 / SC-70</option>
            <option value="SOT-89">SOT-89 Power Transistor</option>
            <option value="SOT-223">SOT-223 Regulator</option>
            <option value="TO-252">TO-252 / DPAK</option>
            <option value="TO-263">TO-263 / D2PAK</option>
          </optgroup>
          <optgroup label="Surface Mount — Small Outline ICs">
            <option value="SOIC-8">SOIC-8 (1.27mm pitch)</option>
            <option value="SOIC-14">SOIC-14 (1.27mm pitch)</option>
            <option value="SOIC-16">SOIC-16 (1.27mm pitch)</option>
            <option value="SOIC-16-W">SOIC-16 Wide (7.5mm body)</option>
            <option value="SOIC-20-W">SOIC-20 Wide (7.5mm body)</option>
            <option value="SSOP-16">SSOP-16 (0.65mm pitch)</option>
            <option value="SSOP-20">SSOP-20 (0.65mm pitch)</option>
            <option value="TSSOP-8">TSSOP-8 (0.65mm pitch)</option>
            <option value="TSSOP-14">TSSOP-14 (0.65mm pitch)</option>
            <option value="TSSOP-16">TSSOP-16 (0.65mm pitch)</option>
            <option value="TSSOP-20">TSSOP-20 (0.65mm pitch)</option>
            <option value="TSSOP-28">TSSOP-28 (0.65mm pitch)</option>
            <option value="MSOP-8">MSOP-8 (0.65mm pitch)</option>
            <option value="MSOP-10">MSOP-10 (0.65mm pitch)</option>
            <option value="QSOP-16">QSOP-16 (0.635mm pitch)</option>
          </optgroup>
          <optgroup label="Surface Mount — Quad (fine pitch)">
            <option value="QFN-16">QFN-16 (0.5mm pitch, 4mm body)</option>
            <option value="QFN-20">QFN-20 (0.5mm pitch)</option>
            <option value="QFN-24">QFN-24 (0.5mm pitch)</option>
            <option value="QFN-28">QFN-28 (0.5mm pitch)</option>
            <option value="QFN-32">QFN-32 (0.5mm pitch, 5mm body)</option>
            <option value="QFN-32-P0.65">QFN-32 (0.65mm pitch, 7mm body)</option>
            <option value="QFN-48">QFN-48 (0.5mm pitch, 7mm body)</option>
            <option value="QFN-64">QFN-64 (0.5mm pitch, 9mm body)</option>
            <option value="DFN-8">DFN-8 (0.5mm pitch)</option>
            <option value="DFN-10">DFN-10 (0.5mm pitch)</option>
            <option value="TQFP-32">TQFP-32 (0.8mm pitch, 7mm body)</option>
            <option value="TQFP-44">TQFP-44 (0.8mm pitch, 10mm body)</option>
            <option value="TQFP-64">TQFP-64 (0.5mm pitch, 10mm body)</option>
            <option value="TQFP-100">TQFP-100 (0.5mm pitch, 14mm body)</option>
            <option value="LQFP-48">LQFP-48 (0.5mm pitch)</option>
            <option value="LQFP-64">LQFP-64 (0.5mm pitch)</option>
          </optgroup>
          <optgroup label="Custom">
            <option value="CUSTOM-PARAMETRIC">Custom footprint (set dimensions below)</option>
          </optgroup>
        </select>
        {isFineParametric && (
          <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
            Fine-pitch part. Check the DRC after export — isolation milling needs a very
            sharp V-bit and a levelled board at this pad spacing.
          </p>
        )}
      </div>

      {showFootprintEditor && (
        <div className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center justify-between">
            <span>Custom Footprint Dimensions</span>
            <span className="text-[10px] text-indigo-500 font-mono font-bold">mm</span>
          </label>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-2 leading-snug">
            For breakout modules and parts that match no catalogue package. Row spacing
            is the centre-to-centre distance between the two pin rows; the offsets shift
            one row along its own axis when the two headers are staggered.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <FootprintField label="Layout" >
              <select
                value={fp.family ?? 'dual'}
                onChange={e => updateFootprintParam('family', e.target.value)}
                className={FOOTPRINT_INPUT_CLASS}
              >
                <option value="dual">Dual row (module / DIP-like)</option>
                <option value="dip">Dual row, through-hole IC</option>
                <option value="quad">Quad (4 sides, SMD)</option>
                <option value="header">Single row header</option>
              </select>
            </FootprintField>

            {fp.family === 'quad' || fp.family === 'header' ? (
              <FootprintNumber label="Total pins" value={fp.pinCount} step={1}
                onChange={v => updateFootprintParam('pinCount', v)} />
            ) : (
              <>
                <FootprintNumber label="Pins, left row" value={fp.leftCount} step={1}
                  onChange={v => updateFootprintParam('leftCount', v)} />
                <FootprintNumber label="Pins, right row" value={fp.rightCount} step={1}
                  onChange={v => updateFootprintParam('rightCount', v)} />
              </>
            )}

            <FootprintNumber label="Pin pitch" value={fp.pitchMm} step={0.05}
              onChange={v => updateFootprintParam('pitchMm', v)} />
            {fp.family !== 'header' && (
              <FootprintNumber
                label={fp.family === 'quad' ? 'Pad span' : 'Row spacing'}
                value={fp.rowSpacingMm}
                step={0.01}
                onChange={v => updateFootprintParam('rowSpacingMm', v)}
              />
            )}

            <FootprintNumber label="Body width" value={fp.bodyWidthMm} step={0.1}
              onChange={v => updateFootprintParam('bodyWidthMm', v)} />
            <FootprintNumber label="Body height" value={fp.bodyHeightMm} step={0.1}
              onChange={v => updateFootprintParam('bodyHeightMm', v)} />

            <FootprintNumber label="Pad width" value={fp.padWidthMm} step={0.05}
              onChange={v => updateFootprintParam('padWidthMm', v)} />
            <FootprintNumber label="Pad height" value={fp.padHeightMm} step={0.05}
              onChange={v => updateFootprintParam('padHeightMm', v)} />

            {fp.family !== 'quad' && (
              <FootprintNumber label="Drill (0 = SMD)" value={fp.drillDiaMm} step={0.05}
                onChange={v => updateFootprintParam('drillDiaMm', v)} />
            )}
            {fp.family === 'quad' && (
              <FootprintNumber label="Thermal pad (0 = none)" value={fp.thermalPadMm} step={0.1}
                onChange={v => updateFootprintParam('thermalPadMm', v)} />
            )}

            {(fp.family === 'dual' || fp.family === 'dip') && (
              <>
                <FootprintNumber label="Left row offset" value={fp.leftOffsetMm} step={0.01}
                  onChange={v => updateFootprintParam('leftOffsetMm', v)} />
                <FootprintNumber label="Right row offset" value={fp.rightOffsetMm} step={0.01}
                  onChange={v => updateFootprintParam('rightOffsetMm', v)} />
              </>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
              {previewFootprint
                ? `${previewFootprint.pads.length} pads · ${previewFootprint.widthMm.toFixed(1)} x ${previewFootprint.heightMm.toFixed(1)}mm`
                : '—'}
            </span>
            <button
              onClick={() => updateData('footprintParams', undefined)}
              className="text-[10px] px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Clear override
            </button>
          </div>
        </div>
      )}

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
