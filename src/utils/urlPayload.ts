// ---------------------------------------------------------------------------
// Bytes carried in a URL fragment
//
// Shared by the two things that travel this way: artwork handed to Etch
// (`etchHandoff.ts`) and a circuit shared as a link (`shareLink.ts`).
//
// The fragment rather than the query string, always. A fragment is never sent
// to the server, so it cannot hit nginx's 8KB request-line limit — which a
// 25KB dense board would — and it never appears in an access log. Browsers
// allow far more room there than any server would.
//
// base64url rather than base64: `+` and `/` survive a fragment, but `+` comes
// back out of `URLSearchParams` as a space, so a plain-base64 payload arrives
// corrupt for exactly the circuits unlucky enough to encode one.
// ---------------------------------------------------------------------------

/** base64url — the URL-safe alphabet, so the fragment needs no escaping. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: a spread of a large array overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(data: string): Uint8Array {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The writer's own promises are swallowed deliberately. A truncated payload —
// which is what a chat app that shortened a link hands back — fails at both
// ends of the stream at once, and the write side rejecting with nobody waiting
// on it is an unhandled rejection on top of the error the reader already
// reports. The reader is the one that answers.
const ignore = () => {};

/** Gzips, or returns null where the browser has no `CompressionStream`. */
export async function gzip(text: string): Promise<Uint8Array | null> {
  // Everywhere current, but a browser without it should hand over a bigger
  // fragment rather than nothing at all.
  if (typeof CompressionStream === 'undefined') return null;

  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(text)).catch(ignore);
  writer.close().catch(ignore);

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

export async function gunzip(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read a compressed link.');
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes as unknown as BufferSource).catch(ignore);
  writer.close().catch(ignore);

  const reader = ds.readable.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}
