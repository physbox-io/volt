import { useEffect, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { X, Trash2, RotateCw, ArrowLeftRight } from 'lucide-react';
import {
  ORIENTABLE_NODE_TYPES,
  canReverseLeads,
  orientationQuarterTurns,
  remapHandleForReverse,
  reverseOrientation,
  rotateOrientation,
} from '../utils/nodeGeometry';
import { getNodeDefaultName } from '../utils/nodeNaming';
import { datasheets } from '../utils/datasheets';
import {
  defaultPackageForType,
  footprintFromParams,
  packageOptionsForType,
  resolveFootprint,
  supportsPackageSelection,
  type FootprintParams,
} from '../utils/pcbFootprints';
import { isPhysical } from '../utils/pcbNets';
import { minPadGapMm } from '../utils/pcbTooling';
import { nodeRegistry } from './nodes/registry';
import { getBjtModel, getMosfetModel, getOpAmpModel } from '../utils/deviceModels';

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

/**
 * Every parameter a device model supplies. Cleared when a catalogue part is
 * chosen so the part itself provides them; see updateData.
 */
const DEVICE_PARAM_KEYS = [
  'bf', 'is', 'vaf', 'ikf', 'rb', 'cjc', 'cje',                 // BJT
  'vto', 'kp', 'lambda', 'rd', 'rs', 'cgs', 'cgd',              // MOSFET
  'gain', 'gbw', 'rin', 'rout', 'vRailDropHi', 'vRailDropLo',   // op-amp
];

function isCatalogPart(nodeType: string | undefined, modelId: unknown): boolean {
  if (typeof modelId !== 'string') return false;
  if (nodeType === 'npn' || nodeType === 'pnp') return !!getBjtModel(nodeType, modelId);
  if (nodeType === 'nmos' || nodeType === 'pmos') return !!getMosfetModel(nodeType, modelId);
  if (nodeType === 'opamp') return !!getOpAmpModel(modelId);
  return false;
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

      // Picking a part from the catalogue clears the per-parameter overrides,
      // for the same reason editing a label clears the numeric ones: the part
      // is now the source of those numbers. It used to copy all of them onto
      // the node instead, which left every device carrying a frozen snapshot of
      // the catalogue — a correction to a model never reached a circuit already
      // drawn, and 'custom' could not be told apart from 'the defaults, written
      // out'. Editing any one of them writes it back and sets model='custom'.
      if (key === 'model' && value !== 'custom' && isCatalogPart(selectedNode?.type, value)) {
        DEVICE_PARAM_KEYS.forEach(k => {
          if (k in newData) delete (newData as any)[k];
        });
      }

      return { ...n, data: newData };
    }));

    if (isSimulating) {
      if (simDebounceTimerRef.current) {
        clearTimeout(simDebounceTimerRef.current);
      }
      simDebounceTimerRef.current = setTimeout(() => {
        runSimulation();
      }, 150);
    }
  };

  /**
   * Turn the selected part end-for-end: the symbol makes a half turn while its
   * wires stay where they are, so the two leads trade places and the netlist
   * reverses with them. Rotating twice does not do this - that turns the pins
   * round with the body, wires and all, and leaves the circuit unchanged.
   *
   * A pin header reverses on the same terms, only with a whole strip of pads
   * trading places rather than a pair of leads: pin 1 ends up at the far end,
   * under whatever was wired to the pad that used to be there.
   */
  const reverseLeads = () => {
    if (!selectedNode) return;
    const type = selectedNode.type || '';
    updateData('orientation', reverseOrientation(selectedNode.data.orientation));
    setEdges((eds: Edge[]) => eds.map(e => {
      const updated = { ...e };
      let changed = false;
      if (e.source === selectedNode.id && e.sourceHandle) {
        const next = remapHandleForReverse(type, e.sourceHandle, selectedNode.data);
        if (next) { updated.sourceHandle = next; changed = true; }
      }
      if (e.target === selectedNode.id && e.targetHandle) {
        const next = remapHandleForReverse(type, e.targetHandle, selectedNode.data);
        if (next) { updated.targetHandle = next; changed = true; }
      }
      return changed ? updated : e;
    }));
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

  // What the selector shows, and the packages it is filtered down to. Whatever
  // is set on the node wins even if this component type would not normally be
  // offered it, so an existing board keeps the footprint it was laid out with.
  const setPackageId = selectedNode.data?.packageId as string | undefined;
  const packageGroups = packageOptionsForType(
    selectedNode.type,
    setPackageId === CUSTOM_PACKAGE_ID ? undefined : setPackageId
  );
  // Falling back to the first offered package rather than a blanket 0805: for a
  // part that is never a chip passive, 0805 is a selection nobody made showing
  // as though somebody had.
  const selectedPackageId = showFootprintEditor
    ? CUSTOM_PACKAGE_ID
    : setPackageId ||
      defaultPackageForType(selectedNode.type) ||
      packageGroups[0]?.options[0]?.id ||
      '0805';

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
      className={`absolute inset-y-0 right-0 w-88 max-lg:max-w-[80vw] glass-panel border-l border-slate-200 dark:border-slate-800 p-4 bg-white/95 dark:bg-slate-900/95 shadow-xl lg:shadow-none z-40 max-lg:z-[110] lg:relative lg:z-10 overflow-y-auto transition-colors max-lg:transition-transform max-lg:duration-200 ${
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
      {isPhysical(selectedNode.type) && supportsPackageSelection(selectedNode.type) && (
      <div className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
          <span>PCB Footprint Package</span>
          <span className="text-[10px] text-indigo-500 font-mono font-bold">CNC Milling</span>
        </label>
        <select
          value={selectedPackageId}
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
          {/*
            Only the packages this kind of part is actually made in. The full
            catalogue was every package in the library for every component,
            which offered a DIP-16 for an LED — and picking it mills sixteen
            holes for a two-lead part with nothing downstream able to tell that
            from a deliberate choice.
          */}
          {packageGroups.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </optgroup>
          ))}
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
      )}

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

      {ORIENTABLE_NODE_TYPES.includes(selectedNode.type || '') && (
        <div className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Orientation</label>
          <button
            onClick={() => updateData(
              'orientation',
              rotateOrientation(selectedNode.type || '', selectedNode.data.orientation)
            )}
            className="w-full flex items-center justify-center gap-2 text-xs px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Turn the part a quarter turn clockwise; its wires come with it"
          >
            <RotateCw size={13} />
            Rotate 90° right
            <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
              {orientationQuarterTurns(selectedNode.data.orientation) * 90}°
            </span>
          </button>
          {canReverseLeads(selectedNode.type || '', selectedNode.data) && (
            <button
              onClick={reverseLeads}
              className="mt-1.5 w-full flex items-center justify-center gap-2 text-xs px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              title={selectedNode.type === 'pinheader'
                ? 'Turn the header end-for-end: the wires stay put and the pad numbering runs the other way, so pin 1 moves to the far end of the strip'
                : 'Turn the part end-for-end: the wires stay put and the two leads trade places, so the polarity in the circuit reverses'}
            >
              <ArrowLeftRight size={13} />
              {selectedNode.type === 'pinheader' ? 'Reverse pin order' : 'Reverse leads'}
            </button>
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
            className="w-full text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none"
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
