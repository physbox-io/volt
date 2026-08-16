export interface NetlistResultIndex {
  timestamps_ms: number[];
  indexByName: Map<string, number>;
}

/** Builds a lookup index for a SPICE result so repeated `findNetGraph` calls (e.g. once per HIL slice) are O(1) instead of re-scanning `variableNames`. */
export function buildNetlistResultIndex(result: any): NetlistResultIndex {
  const timestamps_ms = (result?.data && result.data.length > 0 && result.data[0].values)
    ? result.data[0].values.map((t: number) => t * 1000)
    : [];
  const indexByName = new Map<string, number>();
  if (result?.variableNames) {
    result.variableNames.forEach((name: string, i: number) => {
      indexByName.set(name.toLowerCase(), i);
    });
  }
  return { timestamps_ms, indexByName };
}

/** Looks up a net's voltage series by name (handling ground '0' and the 'v(name)' variable naming convention). Pass a prebuilt `index` when calling repeatedly for the same result. */
export function findNetGraph(result: any, netName: string, index?: NetlistResultIndex) {
  if (!netName || !result) return null;
  const resultIndex = index ?? buildNetlistResultIndex(result);
  const search = netName.toLowerCase();

  if (search === '0') {
    return { name: '0', timestamps_ms: resultIndex.timestamps_ms, voltage_levels: new Array(resultIndex.timestamps_ms.length).fill(0) };
  }

  const idx = resultIndex.indexByName.get(search) ?? resultIndex.indexByName.get(`v(${search})`);
  if (idx === undefined || !result.data[idx]) return null;
  return { name: result.variableNames[idx], timestamps_ms: resultIndex.timestamps_ms, voltage_levels: result.data[idx].values };
}
