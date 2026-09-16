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
import { createShare, fetchSharedDocument, getStoredUser } from './apiClient';

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
  /**
   * Set when the circuit was left with the account rather than put in the link.
   *
   * It is what "stop sharing" needs, and it is how the panel knows there is
   * anything to stop: a link with the circuit inside it cannot be recalled, and
   * offering to turn one off would be a lie.
   */
  token?: string;
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

// ---------------------------------------------------------------------------
// The other kind of link: a token, with the circuit left in the account
//
// Everything above puts the circuit in the URL, which needs no server and no
// account and is right for almost every board. It is not right for an MCU node
// carrying firmware source, or a circuit saved with its routed geometry.
//
// In the *query string*, not the fragment, which is the opposite of the choice
// above and for the reason this path exists: a link that a chat app rewrites is
// exactly what the fragment could not survive, and a rewrite keeps the query
// and drops the fragment. The cost is that the token appears in an access log,
// which is why it is 128 bits of randomness and why it can be revoked.
//
// What is stored is a snapshot and the server will not let it be edited
// afterwards. Somebody who vouches for a link is vouching for what they sent.
// Changing the circuit means making a new link.
// ---------------------------------------------------------------------------

/**
 * The query parameter a token-shared document arrives in.
 *
 * The same name in every Physbox app rather than one word per app. A token is
 * opaque and says nothing about where it belongs, so the app that receives one
 * asks the server what it is and sends you to the right app if it is not this
 * one — which only works if all three look in the same place for it.
 */
const SHARE_TOKEN_PARAM = 'share';

/** What to call a sibling app when a link turns out to belong to it. */
const APP_NAMES: Record<string, string> = { etch: 'Etch', volt: 'Volt', mesh: 'Mesh' };

/** Whether there is an account to leave a circuit with at all. */
export function canShareViaAccount(): boolean {
  return Boolean(getStoredUser());
}

/**
 * Leaves the circuit with the account and returns the short link for it.
 *
 * No size ceiling of our own here: the server holds the one that matters and
 * says so in its refusal, and a second number kept in the app would be the one
 * that drifted.
 */
export async function buildAccountShareLink(
  circuit: CircuitPreset,
  base: string = window.location.href
): Promise<ShareLink> {
  const name = circuit.name?.replace(/^User:\s*/, '') || 'Volt circuit';
  const { token } = await createShare({ appId: 'volt', name, data: circuit });

  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set(SHARE_TOKEN_PARAM, token);
  const full = url.toString();

  return {
    url: full,
    length: full.length,
    travelsWell: true,
    token,
    notes: [
      'The circuit is stored with your account and the link points at it, so the link stays short.',
      'What it holds cannot be changed afterwards — edit the circuit and share again for a new link.',
      'Anyone with the link can open it, with or without an account. You can turn it off at any time.',
    ],
  };
}

/** The token in the address bar, if this page was opened from an account link. */
export function shareTokenInUrl(search: string = window.location.search): string | null {
  return new URLSearchParams(search).get(SHARE_TOKEN_PARAM);
}

/** Fetches the circuit a token stands for. */
export async function readAccountShareLink(token: string): Promise<CircuitPreset> {
  const share = await fetchSharedDocument(token);
  /*
   * A token carries no hint of which app made it, so a Mesh link pasted into
   * Volt would otherwise be answered with "that link is damaged" — which sends
   * somebody looking for a fault in a link that is perfectly good.
   */
  if (share.appId && share.appId !== 'volt') {
    const other = APP_NAMES[share.appId] ?? share.appId;
    throw new Error(`That link is a ${other} document, not a Volt circuit. Open it in ${other}.`);
  }
  const circuit = share.data as CircuitPreset | null;
  if (!circuit || !Array.isArray(circuit.nodes) || !Array.isArray(circuit.edges)) {
    throw new Error('That shared circuit could not be read — it may have been made by a newer version of Volt.');
  }
  return { ...circuit, name: circuit.name || share.name || 'Shared circuit' };
}

/** Takes an opened token back out of the address bar. See `clearShareFragment`. */
export function clearShareToken(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(SHARE_TOKEN_PARAM);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
