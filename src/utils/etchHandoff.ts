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

/** The fragment Etch reads the artwork out of. */
export async function encodeSvgHandoff(svg: string, name: string): Promise<string> {
  const packed = await gzip(svg);
  const params = new URLSearchParams({
    v: HANDOFF_VERSION,
    name,
    gz: packed ? '1' : '0',
    data: toBase64Url(packed ?? new TextEncoder().encode(svg)),
  });
  return params.toString();
}

/**
 * Opens Etch in a new tab with the artwork loaded.
 *
 * The tab is opened *before* the artwork is encoded, blank, and navigated
 * afterwards. Compression is async, and a `window.open` that happens after an
 * await is no longer attributable to the click that started it — which is
 * exactly what a popup blocker stops.
 */
export async function openSvgInEtch(svg: string, name: string): Promise<void> {
  const tab = window.open('', '_blank', 'noopener');
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
