import type { ResultType } from 'eecircuit-engine';

/**
 * A solve as it crosses the worker boundary.
 *
 * The engine hands back one plain array per variable, and a transient run over
 * a few dozen nets is hundreds of thousands of numbers — structured clone walks
 * every one of them on the way out and allocates every one again on the way
 * in. Packed into a Float64Array each, the buffers are transferred instead of
 * copied. Float64 rather than Float32 because that is what ngspice wrote: time
 * at a 50µs step over a long run needs the bits, and nothing is lost this way.
 *
 * A frequency sweep's `{ real, img }` pairs are interleaved into one array of
 * twice the length, so they cost two numbers each rather than an object each.
 */
export type PackedResult = Omit<ResultType, 'data'> & {
  data: { name: string; type: string; values: Float64Array }[];
};

export function packResult(result: ResultType): { packed: PackedResult; transfer: ArrayBuffer[] } {
  const data = result.dataType === 'complex'
    ? result.data.map(d => {
        const values = new Float64Array(d.values.length * 2);
        for (let i = 0; i < d.values.length; i++) {
          values[2 * i] = d.values[i].real;
          values[2 * i + 1] = d.values[i].img;
        }
        return { name: d.name, type: d.type, values };
      })
    : result.data.map(d => ({ name: d.name, type: d.type, values: Float64Array.from(d.values) }));
  return {
    packed: { ...result, data } as PackedResult,
    transfer: data.map(d => d.values.buffer as ArrayBuffer),
  };
}

/**
 * Back to the engine's own shape, with plain arrays.
 *
 * Not left as typed arrays: the series end up in node data that is saved and
 * synced as JSON, where a Float64Array becomes `{"0":…,"1":…}`, and readers
 * spread and `.map` them expecting `number[]`.
 */
export function unpackResult(packed: PackedResult): ResultType {
  if (packed.dataType === 'complex') {
    return {
      ...packed,
      dataType: 'complex',
      data: packed.data.map(d => {
        const values = new Array(d.values.length / 2);
        for (let i = 0; i < values.length; i++) {
          values[i] = { real: d.values[2 * i], img: d.values[2 * i + 1] };
        }
        return { name: d.name, type: d.type, values };
      }),
    } as ResultType;
  }
  return {
    ...packed,
    dataType: 'real',
    data: packed.data.map(d => ({ name: d.name, type: d.type, values: Array.from(d.values) })),
  } as ResultType;
}
