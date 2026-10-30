import { describe, it, expect } from 'vitest';
import type { PcbLayoutResult, PlacedComponent } from '../src/utils/pcbExporter';
import { generateMountingHoleFootprint, resolveFootprint } from '../src/utils/pcbFootprints';
import { fromBase64Url } from '../src/utils/urlPayload';
import {
  encodeMeshPcbHandoff,
  layoutToMeshSpec,
  meshPcbHandoffUrl,
  partHeightMm,
} from '../src/utils/meshPcbHandoff';

function placed(id: string, type: string, x: number, y: number, packageId?: string): PlacedComponent {
  const footprint = type === 'mountinghole'
    ? generateMountingHoleFootprint(3.2)
    : resolveFootprint(packageId, type);
  return {
    id, name: id.toUpperCase(), type, x, y, rotationDeg: 0, footprint,
    widthMm: footprint.widthMm, heightMm: footprint.heightMm,
  };
}

// A 60 x 40 board whose lower-left corner sits 1 mm in from the program origin.
function layout(components: PlacedComponent[], layers: 1 | 2 = 1): PcbLayoutResult {
  return {
    boardWidthMm: 60, boardHeightMm: 40, boardOriginMm: 1, components, layers,
  } as unknown as PcbLayoutResult;
}

const OPTS = { boardThicknessMm: 1.6, profileToolDiaMm: 2, mirrorSingleSided: true };

describe('layoutToMeshSpec', () => {
  it('centres the board, and takes the milling mirror back out of a single-sided one', () => {
    // Milled mirrored: a part at machine x = 1 + 10 sits 20 mm left of centre
    // on the copper, so 20 mm RIGHT of centre seen from the parts' face.
    const spec = layoutToMeshSpec(layout([placed('r1', 'resistor', 11, 31, '0805')]), OPTS);
    expect(spec.widthMm).toBe(60);
    expect(spec.depthMm).toBe(40);
    expect(spec.cornerRadiusMm).toBe(1);
    expect(spec.components[0].xMm).toBe(20);
    expect(spec.components[0].yMm).toBe(10);
  });

  it('leaves a two-layer board, or an unmirrored one, as drawn', () => {
    const two = layoutToMeshSpec(layout([placed('r1', 'resistor', 11, 21, '0805')], 2), OPTS);
    expect(two.components[0].xMm).toBe(-20);
    const plain = layoutToMeshSpec(layout([placed('r1', 'resistor', 11, 21, '0805')]), {
      ...OPTS, mirrorSingleSided: false,
    });
    expect(plain.components[0].xMm).toBe(-20);
  });

  it('turns mounting-hole parts into mounting holes with a screw size, and drops vias', () => {
    const spec = layoutToMeshSpec(
      layout([placed('mh1', 'mountinghole', 5, 5), placed('v1', 'via', 30, 20)]),
      OPTS
    );
    expect(spec.components).toHaveLength(0);
    expect(spec.mountingHoles).toHaveLength(1);
    expect(spec.mountingHoles[0]).toMatchObject({ drillMm: 3.2, fastener: 'M3', xMm: 26, yMm: -16 });
  });

  it('gives parts a seated height, puts surface-mount parts on a mirrored board underneath, and opens the lid over controls', () => {
    const spec = layoutToMeshSpec(
      layout([
        placed('rv1', 'potentiometer', 20, 20, 'POT-3PIN'),
        placed('c1', 'capacitor', 30, 20, '0805'),
        placed('d1', 'led', 40, 20, 'LED-5MM'),
      ]),
      OPTS
    );
    const [pot, cap, led] = spec.components;
    expect(pot.kind).toBe('potentiometer');
    expect(pot.heightMm).toBe(15);
    expect(pot.panelMount).toMatchObject({ face: 'top', cutoutShape: 'd_shaft' });
    expect(cap.side).toBe('bottom');
    expect(cap.panelMount).toBeUndefined();
    expect(led.kind).toBe('led_5mm');
    expect(led.panelMount?.diameterMm).toBe(5.2);
  });

  it('knows common package heights', () => {
    expect(partHeightMm('RADIAL-5MM')).toBe(11);
    expect(partHeightMm('DIP-8')).toBe(5);
    expect(partHeightMm('HEADER-1x04')).toBe(8.5);
    expect(partHeightMm('SOIC-8')).toBe(1.75);
    expect(partHeightMm('SOMETHING-ELSE')).toBe(5);
  });
});

describe('the Mesh fragment', () => {
  it('carries the spec as base64url JSON in the shape Mesh decodes', () => {
    const spec = layoutToMeshSpec(layout([placed('r1', 'resistor', 11, 21, '0805')]), OPTS, 'Fuzz box');
    const params = new URLSearchParams(encodeMeshPcbHandoff(spec));
    expect(params.get('v')).toBe('1');
    expect(params.get('name')).toBe('Fuzz box');
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(params.get('pcb')!)));
    expect(decoded).toEqual(spec);
    expect(meshPcbHandoffUrl(spec, 'http://localhost:5175/')).toMatch(/^http:\/\/localhost:5175\/#v=1&pcb=/);
  });
});
