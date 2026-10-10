import { describe, it, expect } from 'vitest';
import { decodeCavityFragment } from '../src/utils/meshCavity';

/** The fragment Mesh's "Measure cavity" opens Volt with, read back. */
describe('a cavity handed over from Mesh', () => {
  it('reads the volume, the body and the port', () => {
    expect(decodeCavityFragment('#v=1&cavity=0.00102&body=box&scene=Speaker%20box&portLength=0.05&portRadius=0.01')).toEqual({
      body: 'box', scene: 'Speaker box', cavityVolume: 0.00102, portLength: 0.05, portRadius: 0.01,
    });
  });

  it('is sealed when no port came with it, or only half of one', () => {
    expect(decodeCavityFragment('#v=1&cavity=0.002&body=b')).toEqual({ body: 'b', scene: undefined, cavityVolume: 0.002 });
    expect(decodeCavityFragment('#v=1&cavity=0.002&body=b&portLength=0.05')).toEqual({ body: 'b', scene: undefined, cavityVolume: 0.002 });
  });

  it('is not a shared circuit, a newer format, or a cavity of nothing', () => {
    expect(decodeCavityFragment('#v=1&gz=1&circuit=abc')).toBeNull();
    expect(decodeCavityFragment('#v=2&cavity=0.001&body=b')).toBeNull();
    expect(decodeCavityFragment('#v=1&cavity=0&body=b')).toBeNull();
    expect(decodeCavityFragment('#v=1&cavity=0.001')).toBeNull();
    expect(decodeCavityFragment('')).toBeNull();
  });
});
