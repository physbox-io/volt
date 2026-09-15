import { describe, it, expect } from 'vitest';
import {
  buildShareLink,
  encodeShareFragment,
  decodeShareFragment,
  ShareTooLargeError,
  SHARE_SOFT_LIMIT,
  SHARE_HARD_LIMIT,
} from '../src/utils/shareLink';
import { basicBlink } from '../src/utils/presets';
import type { CircuitPreset } from '../src/utils/storage';

const BASE = 'https://volt.example/app/';

/**
 * A circuit big enough to reach the limits, made of bytes that do not
 * compress: a hundred copies of the same resistor gzip down to nothing and
 * would test the ceiling against a circuit that has none of the problem.
 */
function bulky(bytes: number): CircuitPreset {
  let seed = 1;
  let blob = '';
  while (blob.length < bytes) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    blob += (seed >>> 8).toString(36);
  }
  return {
    ...basicBlink,
    name: 'Firmware-heavy board',
    nodes: [
      ...basicBlink.nodes,
      { id: 'mcu', type: 'mcu', position: { x: 0, y: 0 }, data: { label: 'MCU', source: blob } },
    ],
  };
}

describe('encodeShareFragment', () => {
  it('round-trips a circuit', async () => {
    const back = await decodeShareFragment(await encodeShareFragment(basicBlink));
    expect(back?.name).toBe(basicBlink.name);
    expect(back?.nodes).toHaveLength(basicBlink.nodes.length);
    expect(back?.edges.map((e) => e.id)).toEqual(basicBlink.edges.map((e) => e.id));
  });

  // A board is milled with the trace width and clearance it was routed for, so
  // a link that dropped them is a link to a board that mills differently.
  it('carries the board settings the circuit was routed with', async () => {
    const withCam: CircuitPreset = { ...basicBlink, pcbOptions: { traceWidthMm: 0.4, clearanceMm: 0.3 } };
    const back = await decodeShareFragment(await encodeShareFragment(withCam));
    expect(back?.pcbOptions).toEqual({ traceWidthMm: 0.4, clearanceMm: 0.3 });
  });

  // `savedAt` is how the cloud merge tells two copies of a preset apart. A
  // shared circuit is a new thing on the receiving machine, not an older copy
  // of one it already has.
  it('leaves the save timestamp behind', async () => {
    const back = await decodeShareFragment(await encodeShareFragment({ ...basicBlink, savedAt: 1700000000000 }));
    expect(back?.savedAt).toBeUndefined();
  });
});

describe('decodeShareFragment', () => {
  it('ignores an ordinary fragment, and one meant for Etch', async () => {
    expect(await decodeShareFragment('#some-anchor')).toBeNull();
    expect(await decodeShareFragment('#v=1&gz=1&data=abc&name=stencil')).toBeNull();
  });

  it('refuses a version it does not know', async () => {
    const frag = (await encodeShareFragment(basicBlink)).replace('v=1', 'v=2');
    await expect(decodeShareFragment(frag)).rejects.toThrow(/newer version/);
  });

  // Exactly what a chat app that shortened the link hands back. The raw
  // failure is a zlib buffer error or a JSON position; neither is an answer.
  it('calls a truncated link damaged', async () => {
    const frag = await encodeShareFragment(basicBlink);
    await expect(decodeShareFragment(frag.slice(0, frag.length - 40))).rejects.toThrow(/damaged/);
  });

  it('rejects a fragment that decodes to something that is not a circuit', async () => {
    const notACircuit = await encodeShareFragment({ name: 'x' } as unknown as CircuitPreset);
    await expect(decodeShareFragment(notACircuit)).rejects.toThrow(/damaged/);
  });
});

describe('buildShareLink', () => {
  it("drops the sender's own query and fragment", async () => {
    const link = await buildShareLink(basicBlink, `${BASE}?debug=1#leftover`);
    expect(link.url.startsWith(`${BASE}#`)).toBe(true);
    expect(link.url).not.toContain('debug=1');
    expect(link.url).not.toContain('leftover');
  });

  it('is short enough for a share sheet for an ordinary circuit', async () => {
    const link = await buildShareLink(basicBlink, BASE);
    expect(link.length).toBeLessThan(SHARE_SOFT_LIMIT);
    expect(link.travelsWell).toBe(true);
    expect(link.notes.some((n) => /shorten/.test(n))).toBe(false);
  });

  it('warns when the link is long enough for a chat app to shorten it', async () => {
    const link = await buildShareLink(bulky(40 * 1024), BASE);
    expect(link.length).toBeGreaterThan(SHARE_SOFT_LIMIT);
    expect(link.travelsWell).toBe(false);
    expect(link.notes.some((n) => /shorten/.test(n))).toBe(true);
  });

  // WebKit gives up around 80KB and does it silently: the link opens an empty
  // canvas, which reads as "sharing is broken" rather than "too big for a URL".
  it('refuses a circuit too big for a URL instead of making a link that opens nothing', async () => {
    await expect(buildShareLink(bulky(200 * 1024), BASE)).rejects.toBeInstanceOf(ShareTooLargeError);
    await expect(buildShareLink(bulky(200 * 1024), BASE)).rejects.toThrow(/Export the JSON/);
  });

  it('never returns a link past the hard limit', async () => {
    const link = await buildShareLink(bulky(40 * 1024), BASE);
    expect(link.length).toBeLessThanOrEqual(SHARE_HARD_LIMIT);
  });
});
