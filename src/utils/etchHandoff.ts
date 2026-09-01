// ---------------------------------------------------------------------------
// Handing artwork to Physbox Etch
//
// Etch is a separate app on a separate origin, so there is no shared storage
// to put a document in: the artwork has to travel in the URL.
//
// It travels in the *fragment*, not the query string, for two reasons. A
// fragment is never sent to the server, so it cannot hit nginx's 8KB
// request-line limit (which a 25KB dense board would) and it never lands in an
// access log. And browsers allow far more room there than any server would.
// Gzipped and base64url'd, a 272-aperture board is under 5KB.
// ---------------------------------------------------------------------------

/** Format version, so Etch can refuse a fragment it does not understand. */
const HANDOFF_VERSION = '1';

/**
 * Where Etch lives.
 *
 * Dev ports are fixed and adjacent (Volt 5174, Etch 5176), so a developer
 * running both gets the local one without configuring anything, and everyone
 * else gets the deployed app.
 */
export function etchBaseUrl(): string {
  const override = localStorage.getItem('etchBaseUrl');
  if (override) return override.replace(/\/+$/, '');
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:5176`;
  }
  return 'https://etch.physbox.io';
}

/** base64url — the URL-safe alphabet, so the fragment needs no escaping. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: a spread of a large array overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function gzip(text: string): Promise<Uint8Array | null> {
  // Everywhere current, but a browser without it should hand over a bigger
  // fragment rather than nothing at all.
  if (typeof CompressionStream === 'undefined') return null;

  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(new TextEncoder().encode(text));
  void writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * How big a fragment is still worth sending uncompressed.
 *
 * Well past any real board — the densest tested is 25KB — and well inside what
 * browsers take in a fragment. It exists so that an implausible board still
 * arrives rather than making a URL nothing will open.
 */
const SYNC_LIMIT_BYTES = 48 * 1024;

/** The fragment Etch reads the artwork out of, without compressing it. */
export function encodeSvgHandoffSync(svg: string, name: string): string {
  return new URLSearchParams({
    v: HANDOFF_VERSION,
    name,
    gz: '0',
    data: toBase64Url(new TextEncoder().encode(svg)),
  }).toString();
}

/** The same fragment, gzipped. Async, because `CompressionStream` is. */
export async function encodeSvgHandoff(svg: string, name: string): Promise<string> {
  const packed = await gzip(svg);
  if (!packed) return encodeSvgHandoffSync(svg, name);
  return new URLSearchParams({
    v: HANDOFF_VERSION,
    name,
    gz: '1',
    data: toBase64Url(packed),
  }).toString();
}

/**
 * Opens Etch in a new tab with the artwork loaded.
 *
 * Deliberately not `noopener`. It reads like the safe choice and it is the
 * reason this used to open a blank tab and nothing else: `window.open` returns
 * *null* when noopener is set — that is what the flag means, no handle back —
 * so the null check fired, the error said pop-ups were blocked, and the tab it
 * had just opened sat there empty. The destination is our own app, which is
 * the case where an opener reference is not a hazard.
 */
export async function openSvgInEtch(svg: string, name: string): Promise<void> {
  const plain = encodeSvgHandoffSync(svg, name);

  // The ordinary path: one synchronous call, still inside the click that asked
  // for it, which is what keeps a pop-up blocker out of it.
  if (plain.length <= SYNC_LIMIT_BYTES) {
    const tab = window.open(`${etchBaseUrl()}/#${plain}`, '_blank');
    if (!tab) {
      throw new Error('Etch could not be opened — allow pop-ups for this site and try again.');
    }
    return;
  }

  /*
   * A board big enough to be worth compressing. Compression is async, and a
   * window opened after an await is no longer plainly attributable to the
   * click — so the tab is opened first, empty, and navigated once the artwork
   * is ready.
   */
  const tab = window.open('', '_blank');
  if (!tab) {
    throw new Error('Etch could not be opened — allow pop-ups for this site and try again.');
  }
  try {
    tab.location.href = `${etchBaseUrl()}/#${await encodeSvgHandoff(svg, name)}`;
  } catch (e) {
    tab.close();
    throw e;
  }
}
