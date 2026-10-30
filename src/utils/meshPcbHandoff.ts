// ---------------------------------------------------------------------------
// Handing a laid-out board to Physbox Mesh, to build an enclosure round it
//
// Mesh reads a board as a `PcbMechanicalSpec` — outline, mounting holes, and a
// box per part with a height — and builds the case, standoffs and panel
// cutouts from it (Mesh's src/utils/pcbEnclosureSync.ts holds the reader). It
// travels in the URL fragment as `#v=1&pcb=<base64url JSON>&name=...`, the
// same way artwork goes to Etch.
//
// Mesh's coordinates are board-centred millimetres seen from the face the
// parts sit on, +X right and +Y towards the back. A layout here is in machine
// coordinates from the board's lower-left corner, and a single-sided board is
// milled mirrored (see `mirrorLayoutInX` in pcbExporter.ts), so that mirror is
// taken back out: Mesh has to see the board the way it will be assembled.
// ---------------------------------------------------------------------------

import type { PcbLayoutResult, PcbOptions, PlacedComponent } from './pcbExporter';
import { toBase64Url } from './urlPayload';
import { meshBaseUrl } from './coSimLink';

/** Format version Mesh checks before reading the spec. */
const PCB_HANDOFF_VERSION = '1';

type MeshComponentKind =
  | 'ic' | 'capacitor' | 'resistor' | 'inductor' | 'potentiometer' | 'toggle_switch'
  | 'pushbutton' | 'audio_jack_35mm' | 'barrel_jack' | 'usb_c' | 'led_3mm' | 'led_5mm'
  | 'pin_header' | 'oled_display' | 'heatsink' | 'custom';

interface MeshPanelMount {
  face: 'top' | 'front' | 'back' | 'left' | 'right';
  cutoutShape: 'circle' | 'rect' | 'rounded_rect' | 'd_shaft';
  diameterMm?: number;
  widthMm?: number;
  heightMm?: number;
}

export interface MeshPcbComponent {
  id: string;
  ref: string;
  label?: string;
  kind: MeshComponentKind;
  xMm: number;
  yMm: number;
  side?: 'top' | 'bottom';
  widthMm: number;
  depthMm: number;
  heightMm: number;
  panelMount?: MeshPanelMount;
}

export interface MeshMountingHole {
  id: string;
  xMm: number;
  yMm: number;
  drillMm: number;
  padDiameterMm?: number;
  fastener?: 'M2' | 'M2.5' | 'M3' | 'M4';
}

/** Mesh's `PcbMechanicalSpec`, as much of it as a Volt board fills in. */
export interface MeshPcbSpec {
  name: string;
  widthMm: number;
  depthMm: number;
  thicknessMm: number;
  cornerRadiusMm?: number;
  color?: 'green';
  mountingHoles: MeshMountingHole[];
  components: MeshPcbComponent[];
}

/** Parts that are holes or wire rather than something standing on the board. */
const NOT_PARTS = new Set(['mountinghole', 'via', 'cutout']);

/**
 * How far a package stands above the board, mm, seated as usual: an
 * electrolytic upright, an axial part lying flat, a header with its pins.
 * Matched on the package id's prefix; the first match wins.
 */
const PACKAGE_HEIGHTS: [RegExp, number][] = [
  [/^(0201|0402|0603|0805|1206|1210|2010|2512)$/, 0.8],
  [/^(SOD|SOT|SMA|SMB|SMC)/, 1.3],
  [/^(SOIC|TSSOP|MSOP|SSOP|DFN|QFN|QFP|LQFP|TQFP)/, 1.75],
  [/^TO-252|^TO-263/, 2.5],
  [/^DIP/, 5.0],
  [/^AXIAL/, 3.0],
  [/^RADIAL/, 11.0],
  [/^LED-3/, 5.5],
  [/^LED/, 8.6],
  [/^TO-92/, 8.0],
  [/^TO-220|^TO-247/, 20.0],
  [/^TACT/, 5.0],
  [/^POT/, 15.0],
  [/^HEADER/, 8.5],
  [/^TERMINAL/, 10.0],
  [/^TRANSFORMER/, 20.0],
  [/^JUMPER/, 2.0],
  [/^HELTEC/, 10.0],
];

const DEFAULT_PART_HEIGHT_MM = 5.0;

export function partHeightMm(packageId: string): number {
  const id = packageId.toUpperCase();
  for (const [re, h] of PACKAGE_HEIGHTS) if (re.test(id)) return h;
  return DEFAULT_PART_HEIGHT_MM;
}

/** Mesh's kind for a part, from its node type and package. */
function meshKind(type: string, packageId: string): MeshComponentKind {
  const t = type.toLowerCase();
  const p = packageId.toUpperCase();
  if (t === 'potentiometer') return 'potentiometer';
  if (t === 'switch') return p.startsWith('TACT') ? 'pushbutton' : 'toggle_switch';
  if (t === 'led') return p.startsWith('LED-3') ? 'led_3mm' : p.startsWith('LED') ? 'led_5mm' : 'custom';
  if (t === 'resistor') return 'resistor';
  if (t === 'capacitor') return 'capacitor';
  if (t === 'inductor') return 'inductor';
  if (t === 'pinheader' || p.startsWith('HEADER')) return 'pin_header';
  if (/^(DIP|SOIC|TSSOP|MSOP|SSOP|DFN|QFN|QFP|LQFP|TQFP)/.test(p)) return 'ic';
  return 'custom';
}

/**
 * The parts someone reaches through the lid for: a knob, a button, a light,
 * a display. Everything else stays inside; panel holes on the walls are left
 * to whoever is designing the case, because which wall a jack faces is not
 * something the layout knows.
 */
function topPanelMount(kind: MeshComponentKind, c: PlacedComponent): MeshPanelMount | undefined {
  switch (kind) {
    case 'potentiometer': return { face: 'top', cutoutShape: 'd_shaft', diameterMm: 7.2 };
    case 'pushbutton': return { face: 'top', cutoutShape: 'circle', diameterMm: 4.0 };
    case 'toggle_switch': return { face: 'top', cutoutShape: 'circle', diameterMm: 6.3 };
    case 'led_3mm': return { face: 'top', cutoutShape: 'circle', diameterMm: 3.2 };
    case 'led_5mm': return { face: 'top', cutoutShape: 'circle', diameterMm: 5.2 };
    default:
      if (c.type.toLowerCase() === 'sevenseg') {
        return { face: 'top', cutoutShape: 'rect', widthMm: c.widthMm, heightMm: c.heightMm };
      }
      return undefined;
  }
}

/** The ISO screw a hole of this drill takes, if it is a clearance hole for one. */
function fastenerFor(drillMm: number): MeshMountingHole['fastener'] {
  if (drillMm >= 4.2) return 'M4';
  if (drillMm >= 3.1) return 'M3';
  if (drillMm >= 2.6) return 'M2.5';
  if (drillMm >= 2.1) return 'M2';
  return undefined;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The board as Mesh reads it.
 *
 * `options` must be the ones the layout was made with: whether a single-sided
 * board was mirrored for milling decides which way round its parts are.
 */
export function layoutToMeshSpec(
  result: PcbLayoutResult,
  options: Pick<PcbOptions, 'boardThicknessMm' | 'profileToolDiaMm'> &
    Partial<Pick<PcbOptions, 'layers' | 'mirrorSingleSided'>>,
  name = 'Volt PCB'
): MeshPcbSpec {
  const twoLayer = (result.layers ?? options.layers) === 2;
  const milledMirrored = !twoLayer && options.mirrorSingleSided !== false;
  const cx = result.boardOriginMm + result.boardWidthMm / 2;
  const cy = result.boardOriginMm + result.boardHeightMm / 2;
  const toX = (x: number) => round(milledMirrored ? cx - x : x - cx);
  const toY = (y: number) => round(y - cy);

  const mountingHoles: MeshMountingHole[] = [];
  const components: MeshPcbComponent[] = [];

  for (const c of result.components) {
    const type = c.type.toLowerCase();
    if (type === 'mountinghole') {
      const pad = c.footprint.pads[0];
      const drillMm = pad?.drillDiameter ?? c.widthMm;
      const fastener = fastenerFor(drillMm);
      mountingHoles.push({
        id: c.id,
        xMm: toX(c.x),
        yMm: toY(c.y),
        drillMm: round(drillMm),
        padDiameterMm: round(Math.max(c.widthMm, c.heightMm)),
        ...(fastener ? { fastener } : {}),
      });
      continue;
    }
    if (NOT_PARTS.has(type)) continue;

    const packageId = c.footprint.packageId;
    const kind = meshKind(type, packageId);
    // On a single-sided board a part with no leads through it is soldered to
    // the copper, which is the underside once the board is assembled.
    const throughHole = c.footprint.pads.some(p => (p.drillDiameter ?? 0) > 0);
    const side: 'top' | 'bottom' = !twoLayer && !throughHole && milledMirrored ? 'bottom' : 'top';
    const panelMount = side === 'top' ? topPanelMount(kind, c) : undefined;
    const label = typeof c.data?.label === 'string' && c.data.label.trim() ? c.data.label.trim() : undefined;

    components.push({
      id: c.id,
      ref: c.name,
      ...(label && label !== c.name ? { label } : {}),
      kind,
      xMm: toX(c.x),
      yMm: toY(c.y),
      ...(side === 'bottom' ? { side } : {}),
      // The courtyard after rotation, so Mesh needs no rotation of its own.
      widthMm: round(c.widthMm),
      depthMm: round(c.heightMm),
      heightMm: partHeightMm(packageId),
      ...(panelMount ? { panelMount } : {}),
    });
  }

  return {
    name,
    widthMm: round(result.boardWidthMm),
    depthMm: round(result.boardHeightMm),
    thicknessMm: options.boardThicknessMm,
    // The outline is cut by the profile end mill, so its corners are its radius.
    cornerRadiusMm: round(options.profileToolDiaMm / 2),
    color: 'green',
    mountingHoles,
    components,
  };
}

/** The fragment Mesh reads the board out of, without the `#`. */
export function encodeMeshPcbHandoff(spec: MeshPcbSpec): string {
  return new URLSearchParams({
    v: PCB_HANDOFF_VERSION,
    pcb: toBase64Url(new TextEncoder().encode(JSON.stringify(spec))),
    name: spec.name,
  }).toString();
}

/** The Mesh URL that opens the enclosure builder with this board in it. */
export function meshPcbHandoffUrl(spec: MeshPcbSpec, baseUrl = meshBaseUrl()): string {
  return `${baseUrl.replace(/\/+$/, '')}/#${encodeMeshPcbHandoff(spec)}`;
}

/** Opens Mesh on the board. Synchronous, so it stays inside the click. */
export function openPcbInMesh(spec: MeshPcbSpec): void {
  const tab = window.open(meshPcbHandoffUrl(spec), '_blank');
  if (!tab) throw new Error('Mesh could not be opened — allow pop-ups for this site and try again.');
}
