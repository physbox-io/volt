// ---------------------------------------------------------------------------
// A circuit, shared as a link
//
// Volt has no server of its own for documents — the app runs in the tab — so a
// share link cannot be a short id pointing at a row somewhere. The circuit
// travels inside the link, by the same road the Etch handoff leaves on and for
// the same reasons (`urlPayload.ts`).
//
// What travels is a `CircuitPreset`: the same shape the save dialog writes and
// the preset dropdown loads. A link, a saved circuit and a preset are then the
// same thing, and the receiving app already knows how to apply one — including
// the CAM settings, which belong with the circuit because a board is milled
// with the trace width and clearance it was routed for.
// ---------------------------------------------------------------------------

import type { CircuitPreset } from './storage';
import { toBase64Url, fromBase64Url, gzip, gunzip } from './urlPayload';

/** The only share format understood so far. */
const SHARE_VERSION = '1';

/**
 * Past this the link is long enough that it is worth saying so.
 *
 * Nothing breaks at this length; it is where chat apps and link previewers
 * start rewriting a URL, and a rewritten link is a link with no fragment,
 * which is a link to an empty Volt.
 */
export const SHARE_SOFT_LIMIT = 16 * 1024;

/**
 * Past this the link does not work, so it is not offered.
 *
 * Chromium will carry a couple of megabytes in an address bar and Firefox
 * more, but WebKit gives up around 80KB and does it silently — the link simply
 * opens an empty canvas, which reads as "sharing is broken" rather than "that
 * circuit is too big to put in a URL". 64KB keeps a margin under the lowest
 * ceiling. What reaches it is an MCU node carrying firmware source, or a board
 * whose routed geometry has been saved with it.
 */
export const SHARE_HARD_LIMIT = 64 * 1024;

export interface ShareLink {
  url: string;
  /** Length of the whole URL in characters — what the limits above are about. */
  length: number;
  /**
   * Short enough to hand to the operating system's share sheet.
   *
   * The share sheet is the one route where the link leaves without anyone
   * seeing it, so a link a chat app would shorten is offered only as text to
   * copy, where the warning beside it is actually read.
   */
  travelsWell: boolean;
  notes: string[];
}

/** Thrown when the circuit cannot be put in a URL at all. */
export class ShareTooLargeError extends Error {
  // A plain field rather than a parameter property: this project builds with
  // `erasableSyntaxOnly`, which forbids the shorthand.
  readonly length: number;

  constructor(length: number) {
    super(
      `This circuit needs ${Math.round(length / 1024)}KB of link and browsers stop reading at ` +
        `about ${SHARE_HARD_LIMIT / 1024}KB. Export the JSON and send the file instead.`
    );
    this.name = 'ShareTooLargeError';
    this.length = length;
  }
}

/**
 * The fragment a circuit travels in, without the URL around it.
 *
 * Split from `buildShareLink` so the encoding can be tested at all: the tests
 * in this project run in node, deliberately — nothing else under `utils`
 * touches the DOM — and a function that reaches for `window.location` cannot
 * run there. What is left in the wrapper is three lines of address bar.
 */
export async function encodeShareFragment(circuit: CircuitPreset): Promise<string> {
  // `savedAt` is left out on purpose: it is how the cloud merge tells two
  // copies of a preset apart, and a shared circuit is a new thing on the
  // receiving machine, not an older copy of one it already has.
  const json = JSON.stringify(circuit, (key, value) => (key === 'savedAt' ? undefined : value));
  const packed = await gzip(json);
  return new URLSearchParams({
    v: SHARE_VERSION,
    gz: packed ? '1' : '0',
    circuit: toBase64Url(packed ?? new TextEncoder().encode(json)),
  }).toString();
}

/**
 * Builds a link that opens this circuit in a fresh tab of this app.
 *
 * `base` defaults to where the app is running, with any query and fragment
 * dropped: a share link should not carry the sender's leftover query, and it
 * certainly should not carry the fragment it was itself opened from.
 */
export async function buildShareLink(
  circuit: CircuitPreset,
  base: string = window.location.href
): Promise<ShareLink> {
  const url = new URL(base);
  url.search = '';
  url.hash = '';

  const full = `${url.toString()}#${await encodeShareFragment(circuit)}`;

  if (full.length > SHARE_HARD_LIMIT) throw new ShareTooLargeError(full.length);

  const notes: string[] = [];
  if (full.length > SHARE_SOFT_LIMIT) {
    notes.push(
      `The link is ${Math.round(full.length / 1024)}KB long. Some chat apps shorten a link that ` +
        `long, and a shortened link loses the part of it the circuit is in — paste it somewhere ` +
        `that keeps it whole, or export JSON instead.`
    );
  }
  notes.push(
    'The circuit travels inside the link — nothing is uploaded, and there is nothing to expire.'
  );
  if (circuit.pcbOptions && Object.keys(circuit.pcbOptions).length > 0) {
    notes.push('The board settings it was routed with travel with it.');
  }

  return { url: full, length: full.length, travelsWell: full.length <= SHARE_SOFT_LIMIT, notes };
}

/**
 * Reads a shared circuit out of the URL fragment.
 *
 * It does *not* clear the fragment as it reads. A shared circuit replaces
 * what is on the canvas, so it has to be declinable, and clearing on read
 * meant declining threw the circuit away with no way back to it. The caller
 * calls `clearShareFragment` once it has actually opened it.
 *
 * Distinguished from an Etch-bound handoff by the parameter name, so a
 * fragment meant for the other app is never mistaken for one meant for this.
 */
export async function decodeShareFragment(raw: string): Promise<CircuitPreset | null> {
  const body = raw.replace(/^#/, '');
  if (!body || !body.includes('circuit=')) return null;

  const params = new URLSearchParams(body);
  const data = params.get('circuit');
  if (!data) return null;

  if (params.get('v') !== SHARE_VERSION) {
    throw new Error('That link was made by a newer version of Volt.');
  }

  // A truncated link — which is exactly what a chat app that shortened it
  // hands back — fails somewhere in here with a message about zlib buffers or
  // JSON position 4711. Neither is an answer to "why did my link not work".
  let circuit: CircuitPreset;
  try {
    const bytes = fromBase64Url(data);
    const json = params.get('gz') === '1' ? await gunzip(bytes) : new TextDecoder().decode(bytes);
    circuit = JSON.parse(json) as CircuitPreset;
  } catch {
    throw new Error('That link is damaged — it may have been shortened or cut off in transit.');
  }
  if (!circuit || !Array.isArray(circuit.nodes) || !Array.isArray(circuit.edges)) {
    throw new Error('That link is damaged — it may have been shortened or cut off in transit.');
  }
  return circuit;
}

export function readShareLink(): Promise<CircuitPreset | null> {
  return decodeShareFragment(window.location.hash);
}

/**
 * Takes an opened circuit back out of the address bar.
 *
 * `replaceState` rather than assigning to `location.hash`, which would push a
 * history entry and add a navigation. Leaving it there would re-open the link
 * over whatever had been drawn since, on the next reload.
 */
export function clearShareFragment(): void {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
