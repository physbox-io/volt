// ---------------------------------------------------------------------------
// A cavity measured in Mesh, for a speaker's enclosure
//
// Mesh's "Measure cavity" finds the air volume inside a watertight body and,
// when it has one, the port through its wall. Linked, those are output
// channels like any other — `body:<name>.cavityVolume`, `.portLength`,
// `.portRadius` — and a speaker binds its enclosure settings to them with the
// same picker a Mesh signal uses. Unlinked, Mesh hands them over in the URL
// fragment instead, the way it hands a cut to Etch: the two apps are
// different origins with no shared storage, and a fragment never reaches a
// server. The fragment is kept here until a speaker takes it, since the tab
// it opens may be showing some other circuit first.
// ---------------------------------------------------------------------------

/** The format Mesh writes. Bump only with Mesh's `voltHandoff.ts`. */
const CAVITY_VERSION = '1';

/** Fired on `window` when a cavity arrives, so an open inspector shows it. */
export const CAVITY_EVENT = 'volt:meshCavity';

/** Where a fragment is kept between arriving and being applied. */
const STORAGE_KEY = 'volt:meshCavity';

export type MeshCavity = {
  /** The Mesh body measured. */
  body: string;
  /** The scene it was in, for saying where the numbers came from. */
  scene?: string;
  /** Air volume inside, m³. */
  cavityVolume: number;
  /** The port, m, when the body has one. */
  portLength?: number;
  portRadius?: number;
};

/** Each enclosure setting, the channel it binds to, and the field of a handoff that carries it. */
export const CAVITY_BINDINGS = [
  { param: 'boxVolume', channelKey: 'boxVolumeChannel', suffix: '.cavityVolume', field: 'cavityVolume' },
  { param: 'portLength', channelKey: 'portLengthChannel', suffix: '.portLength', field: 'portLength' },
  { param: 'portRadius', channelKey: 'portRadiusChannel', suffix: '.portRadius', field: 'portRadius' },
] as const;

const positive = (raw: string | null): number | undefined => {
  if (raw === null) return undefined;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

/**
 * Reads a cavity out of a URL fragment, or null when the fragment is not one.
 * Told apart from a shared circuit by its parameter name, as Etch's handoff is.
 */
export function decodeCavityFragment(raw: string): MeshCavity | null {
  const body = raw.replace(/^#/, '');
  if (!body.includes('cavity=')) return null;
  const params = new URLSearchParams(body);
  if (params.get('v') !== CAVITY_VERSION) return null;
  const cavityVolume = positive(params.get('cavity'));
  const name = params.get('body');
  if (cavityVolume === undefined || !name) return null;
  const portLength = positive(params.get('portLength'));
  const portRadius = positive(params.get('portRadius'));
  return {
    body: name,
    scene: params.get('scene') ?? undefined,
    cavityVolume,
    ...(portLength !== undefined && portRadius !== undefined ? { portLength, portRadius } : {}),
  };
}

/** This session's handoff, for when storage is refused (a private window). */
let latest: MeshCavity | null = null;

/** The cavity Mesh last handed over, if any. */
export function storedCavity(): MeshCavity | null {
  if (latest) return latest;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as MeshCavity;
    return c && typeof c.body === 'string' && c.cavityVolume > 0 ? c : null;
  } catch {
    return null;
  }
}

/**
 * Takes a cavity out of the address bar, if one is there, and keeps it for
 * the speaker inspector. `replaceState`, as for a shared circuit, so a reload
 * does not hand it over again.
 */
export function captureCavityFragment(): MeshCavity | null {
  const cavity = decodeCavityFragment(window.location.hash);
  if (!cavity) return null;
  latest = cavity;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cavity));
  } catch { /* refused: this session still has it */ }
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  window.dispatchEvent(new CustomEvent(CAVITY_EVENT));
  return cavity;
}
