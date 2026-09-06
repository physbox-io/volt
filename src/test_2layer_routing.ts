/**
 * Comprehensive test suite for 2-Layer PCB routing, vias, registration pins,
 * dual-sided isolation, and CAM G-code flip sequence.
 */
import type { Node, Edge } from '@xyflow/react';
import {
  generatePcbLayout,
  boardOriginOffsetMm,
  DEFAULT_PCB_OPTIONS,
  REGISTRATION_PIN_OFFSET_MM,
  type PcbOptions,
} from './utils/pcbExporter';
import {
  routeBoard,
  viaKeepoutRadiusMm,
  type RoutePin,
  type RouterOptions,
} from './utils/pcbRouter';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    failed++;
  } else {
    console.log(`ok   ${msg}`);
    passed++;
  }
}

// Construct a circuit that requires crossing traces (e.g. 4 resistors crossed in an X pattern)
function makeCrossingCircuit(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: 'R1',
      type: 'resistor',
      data: { label: 'R1', resistance: '1k' },
      position: { x: 0, y: 0 },
    },
    {
      id: 'R2',
      type: 'resistor',
      data: { label: 'R2', resistance: '1k' },
      position: { x: 50, y: 0 },
    },
    {
      id: 'R3',
      type: 'resistor',
      data: { label: 'R3', resistance: '1k' },
      position: { x: 0, y: 50 },
    },
    {
      id: 'R4',
      type: 'resistor',
      data: { label: 'R4', resistance: '1k' },
      position: { x: 50, y: 50 },
    },
  ];

  // Crossing net connections: R1.1 to R4.2, R2.1 to R3.2, R1.2 to R3.1, R2.2 to R4.1
  const edges: Edge[] = [
    { id: 'e1', source: 'R1', target: 'R4', sourceHandle: '1', targetHandle: '2' },
    { id: 'e2', source: 'R2', target: 'R3', sourceHandle: '1', targetHandle: '2' },
    { id: 'e3', source: 'R1', target: 'R3', sourceHandle: '2', targetHandle: '1' },
    { id: 'e4', source: 'R2', target: 'R4', sourceHandle: '2', targetHandle: '1' },
  ];

  return { nodes, edges };
}

function runTests() {
  console.log('--- Running 2-Layer PCB Routing & CAM Tests ---');

  // 1. Verify default options are 1-layer
  assert(DEFAULT_PCB_OPTIONS.layers === 1, 'DEFAULT_PCB_OPTIONS specifies 1 layer');
  assert(DEFAULT_PCB_OPTIONS.viaPadMm === 1.4, 'DEFAULT_PCB_OPTIONS specifies 1.4mm via pad');
  assert(DEFAULT_PCB_OPTIONS.viaDrillMm === 0.8, 'DEFAULT_PCB_OPTIONS specifies 0.8mm via drill');
  assert(
    DEFAULT_PCB_OPTIONS.spoilboardRegistrationDepthMm === 2.0,
    'DEFAULT_PCB_OPTIONS specifies 2.0mm spoilboard registration depth'
  );

  const { nodes, edges } = makeCrossingCircuit();

  // 2. 1-Layer routing on crossing circuit
  const opts1Layer: PcbOptions = {
    ...DEFAULT_PCB_OPTIONS,
    layers: 1,
    boardWidthMm: 40,
    boardHeightMm: 40,
    autoGrowBoard: true,
  };
  const res1 = generatePcbLayout(nodes, edges, opts1Layer);
  assert(res1.layers === 1, '1-layer result reports layers === 1');
  assert(!res1.vias || res1.vias.length === 0, '1-layer result has 0 vias');
  assert(
    res1.drills.filter(d => d.isRegistration).length === 0,
    '1-layer result has 0 registration pin drills'
  );
  assert(res1.gcode.includes('OP 1/3: Isolation routing'), '1-layer G-code has OP 1/3 Isolation');
  assert(res1.gcode.includes('OP 2/3: Through-hole drilling'), '1-layer G-code has OP 2/3 Drilling');
  assert(res1.gcode.includes('OP 3/3: Board edge profile'), '1-layer G-code has OP 3/3 Profile');
  assert(!res1.gcode.includes('M0 ; PAUSE'), '1-layer G-code has no M0 flip pause');

  // 3. 2-Layer routing on crossing circuit
  const opts2Layer: PcbOptions = {
    ...DEFAULT_PCB_OPTIONS,
    layers: 2,
    boardWidthMm: 40,
    boardHeightMm: 40,
    autoGrowBoard: true,
    viaPadMm: 1.4,
    viaDrillMm: 0.8,
    spoilboardRegistrationDepthMm: 2.0,
  };
  const res2 = generatePcbLayout(nodes, edges, opts2Layer);

  assert(res2.layers === 2, '2-layer result reports layers === 2');
  assert(res2.success, '2-layer layout successfully generated without design rule errors');
  assert(res2.completion === 1, '2-layer layout achieved 100% completion');
  assert(Array.isArray(res2.topTraces), 'res2.topTraces is an array');
  assert(Array.isArray(res2.bottomTraces), 'res2.bottomTraces is an array');
  assert(
    res2.topTraces!.length + res2.bottomTraces!.length === res2.traces.length,
    'topTraces + bottomTraces partition res2.traces'
  );

  // Vias and registration pins
  const regPins = res2.drills.filter(d => d.isRegistration);
  assert(regPins.length === 2, '2-layer result has exactly 2 registration pin drills');
  assert(
    regPins[0].diameter === 0.8 && regPins[1].diameter === 0.8,
    'registration pin drill diameter matches viaDrillMm (0.8mm)'
  );
  // Check horizontal symmetry across xMid
  const xMid = res2.boardOriginMm + res2.boardWidthMm / 2;
  const pinDist1 = Math.abs(regPins[0].x - xMid);
  const pinDist2 = Math.abs(regPins[1].x - xMid);
  assert(
    Math.abs(pinDist1 - pinDist2) < 0.001,
    `registration pins are symmetrically placed around xMid (${pinDist1.toFixed(3)}mm vs ${pinDist2.toFixed(3)}mm)`
  );
  assert(
    regPins[0].y === regPins[1].y,
    'registration pins share the same Y centerline'
  );

  // SVG previews
  assert(typeof res2.svg === 'string' && res2.svg.length > 0, 'res2.svg generated');
  assert(
    typeof res2.svgComponentSide === 'string' && res2.svgComponentSide.length > 0,
    'res2.svgComponentSide generated'
  );
  assert(
    typeof res2.svgBottomSide === 'string' && res2.svgBottomSide.length > 0,
    'res2.svgBottomSide generated'
  );
  assert(
    typeof res2.svgComposite === 'string' && res2.svgComposite.length > 0,
    'res2.svgComposite generated'
  );
  assert(
    res2.svgComposite!.includes('Top (F.Cu)') && res2.svgComposite!.includes('Bottom (B.Cu)'),
    'svgComposite includes legend for top and bottom copper'
  );
  assert(
    res2.svgComposite!.includes('pcb-registration-pin'),
    'svgComposite renders registration pin crosshairs'
  );

  // G-code verification
  const gcode = res2.gcode;
  assert(gcode.includes('OP 1/5: Top Isolation routing'), '2-layer G-code has OP 1/5 Top Isolation');
  assert(gcode.includes('OP 2/5: Drilling'), '2-layer G-code has OP 2/5 Drilling');
  assert(
    gcode.includes('OP 3/5: Flip Board & Register with Alignment Pins'),
    '2-layer G-code has OP 3/5 Flip Board'
  );
  assert(gcode.includes('M0 ; PAUSE'), '2-layer G-code includes M0 pause command for board flip');
  assert(
    gcode.includes('OP 4/5: Bottom Isolation routing'),
    '2-layer G-code has OP 4/5 Bottom Isolation'
  );
  assert(gcode.includes('OP 5/5: Board edge profile'), '2-layer G-code has OP 5/5 Profile');

  // Spoilboard plunge depth check
  // Regular drill depth is opts2Layer.drillDepthZ (default -1.8)
  // Spoilboard depth is -1.8 - 2.0 = -3.8
  const expectedRegDepth = (opts2Layer.drillDepthZ - 2.0).toFixed(3);
  assert(
    gcode.includes(`Z${expectedRegDepth}`),
    `2-layer G-code plunges registration pins to Z${expectedRegDepth} (2mm into spoilboard)`
  );

  // Mirrored bottom coordinates check: OP 4/5 moves should be inside mirrored bounds
  const op4Idx = gcode.indexOf('OP 4/5');
  const op5Idx = gcode.indexOf('OP 5/5');
  assert(op4Idx > 0 && op5Idx > op4Idx, 'OP 4 precedes OP 5 in G-code');
  const op4Block = gcode.slice(op4Idx, op5Idx);
  assert(
    op4Block.includes('G1 X') || op4Block.includes('G0 X'),
    'OP 4 contains horizontal motion coordinates'
  );

  // ---------------------------------------------------------------------
  // Vias: the router has to actually place them, and place them legally.
  // A crossing that a single layer can route around proves nothing, so this
  // boxes four top-only (SMD) pads into a board with no way round.
  // ---------------------------------------------------------------------
  const crossingPins: RoutePin[] = [
    { netId: 'A', key: 'p1', componentId: 'U1', x: 3, y: 3, padRadiusMm: 0.6, layer: 'top' },
    { netId: 'B', key: 'p2', componentId: 'U1', x: 9, y: 3, padRadiusMm: 0.6, layer: 'top' },
    { netId: 'A', key: 'p3', componentId: 'U1', x: 9, y: 9, padRadiusMm: 0.6, layer: 'top' },
    { netId: 'B', key: 'p4', componentId: 'U1', x: 3, y: 9, padRadiusMm: 0.6, layer: 'top' },
  ];
  const routerOpts: RouterOptions = {
    boardWidthMm: 12,
    boardHeightMm: 12,
    gridMm: 0.2,
    traceWidthMm: 0.4,
    clearanceMm: 0.4,
    edgeClearanceMm: 1.0,
    bendPenalty: 1.5,
    budgetMs: 8000,
  };

  const routed1 = routeBoard(crossingPins, { ...routerOpts, layers: 1 });
  assert(!routed1.vias || routed1.vias.length === 0, 'a 1-layer route never places a via');

  const routed2 = routeBoard(crossingPins, { ...routerOpts, layers: 2 });
  assert(routed2.completion === 1, '2-layer routes the boxed-in crossing completely');
  assert((routed2.vias?.length ?? 0) > 0, 'the crossing is resolved with at least one via');
  assert(
    routed2.traces.some(t => t.layer === 'bottom'),
    'the detour actually runs on the bottom layer'
  );

  // The keepout a via stamps has to include the half trace width a later
  // trace's centreline carries. Asserted on the rule itself: whether any given
  // board happens to route a trace close enough to a via to expose a short
  // radius depends on the net ordering, so a routed-board check alone can pass
  // with the rule wrong.
  assert(
    Math.abs(viaKeepoutRadiusMm(1.4, 0.4, 0.4) - (0.7 + 0.4 + 0.2)) < 1e-9,
    'via keepout is pad radius + clearance + half trace width'
  );
  assert(
    viaKeepoutRadiusMm(1.4, 0.4, 0.4) > 1.4 / 2 + 0.4,
    'via keepout is wider than pad radius plus clearance alone'
  );

  // Every via's copper must clear other nets by the full clearance. Whether a
  // board exposes a short keepout depends on a trace being routed near a via
  // *after* it lands, so this uses a woven board tight enough for that to
  // happen: with the half trace width left out of the via keepout the gap here
  // comes out at 0.300mm against a 0.4mm clearance.
  const wovenPins: RoutePin[] = [];
  for (let i = 0; i < 4; i++) {
    const net = String.fromCharCode(65 + i);
    wovenPins.push(
      { netId: net, key: `w-a${i}`, componentId: 'U2', x: 3 + i * 1.8, y: 3, padRadiusMm: 0.5, layer: 'top' },
      { netId: net, key: `w-b${i}`, componentId: 'U2', x: 3 + (3 - i) * 1.8, y: 11, padRadiusMm: 0.5, layer: 'top' }
    );
  }
  const wovenOpts: RouterOptions = {
    boardWidthMm: 14,
    boardHeightMm: 14,
    gridMm: 0.15,
    traceWidthMm: 0.4,
    clearanceMm: 0.4,
    edgeClearanceMm: 0.8,
    bendPenalty: 1.5,
    budgetMs: 6000,
    layers: 2,
  };
  const woven = routeBoard(wovenPins, wovenOpts);
  assert((woven.vias?.length ?? 0) > 0, 'the woven board places vias to measure clearance against');

  let worstViaGap = Infinity;
  for (const v of woven.vias ?? []) {
    for (const t of woven.traces) {
      if (t.netId === v.netId) continue;
      for (let i = 0; i + 1 < t.points.length; i++) {
        const a = t.points[i];
        const b = t.points[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        const s = lenSq > 0
          ? Math.max(0, Math.min(1, ((v.x - a.x) * dx + (v.y - a.y) * dy) / lenSq))
          : 0;
        const gap =
          Math.hypot(v.x - (a.x + s * dx), v.y - (a.y + s * dy)) - v.padMm / 2 - t.widthMm / 2;
        worstViaGap = Math.min(worstViaGap, gap);
      }
    }
  }
  assert(
    worstViaGap >= wovenOpts.clearanceMm - 1e-6,
    `via copper clears other nets by the full clearance (worst ${worstViaGap.toFixed(3)}mm)`
  );

  // A through-hole pin already joins the two faces, so a route may use one to
  // change layer and needs no via there - drilling one would put a second hole
  // through a pad that is about to be soldered. On an all-through-hole board
  // like this the router reaches the bottom through the pins alone, so the
  // check is that it does so without drilling anything extra.
  const thtNodes: Node[] = Array.from({ length: 6 }, (_, i) => ({
    id: `T${i + 1}`,
    type: 'resistor',
    data: { label: `T${i + 1}`, resistance: '1k' },
    position: { x: (i % 3) * 40, y: Math.floor(i / 3) * 40 },
  })) as Node[];
  const thtEdges: Edge[] = [
    { id: 'ta', source: 'T1', target: 'T4', sourceHandle: '1', targetHandle: '1' },
    { id: 'tb', source: 'T1', target: 'T5', sourceHandle: '2', targetHandle: '1' },
    { id: 'tc', source: 'T2', target: 'T4', sourceHandle: '1', targetHandle: '2' },
    { id: 'td', source: 'T2', target: 'T6', sourceHandle: '2', targetHandle: '1' },
    { id: 'te', source: 'T3', target: 'T5', sourceHandle: '1', targetHandle: '2' },
    { id: 'tf', source: 'T3', target: 'T6', sourceHandle: '2', targetHandle: '2' },
  ];
  const thtBoard = generatePcbLayout(thtNodes, thtEdges, {
    ...opts2Layer,
    autoJumpers: false,
  });
  assert(
    (thtBoard.bottomTraces?.length ?? 0) > 0,
    'the through-hole board does route onto the bottom layer'
  );
  const thtDrills = thtBoard.drills.filter(d => !d.isVia && !d.isRegistration);
  const viaOnPad = (thtBoard.vias ?? []).some(v =>
    thtDrills.some(d => Math.hypot(v.x - d.x, v.y - d.y) < 1.0)
  );
  assert(!viaOnPad, 'no via is drilled on top of a through-hole pad');

  // Registration holes have to land in material: the 2-layer inset exists to
  // leave margin stock for them outside the finished edge.
  const origin2 = boardOriginOffsetMm(opts2Layer);
  const stockW = res2.boardWidthMm + origin2 * 2;
  const stockH = res2.boardHeightMm + origin2 * 2;
  assert(
    origin2 > boardOriginOffsetMm({ ...opts2Layer, layers: 1 }),
    'a 2-layer board reserves extra margin stock beyond the profile radius'
  );
  const regHoles = res2.drills.filter(d => d.isRegistration);
  assert(regHoles.length === 2, 'exactly two registration holes are drilled');
  for (const d of regHoles) {
    const r = d.diameter / 2;
    assert(
      d.x - r > 0 && d.x + r < stockW && d.y - r > 0 && d.y + r < stockH,
      `registration hole at X${d.x.toFixed(2)} is inside the ${stockW.toFixed(1)}x${stockH.toFixed(1)}mm stock`
    );
    assert(
      d.x < origin2 || d.x > origin2 + res2.boardWidthMm,
      `registration hole at X${d.x.toFixed(2)} is outside the finished board profile`
    );
  }
  assert(
    Math.abs(regHoles[0].x - (origin2 - REGISTRATION_PIN_OFFSET_MM)) < 1e-6,
    'the registration pin sits the documented distance outside the board edge'
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`${failed} test(s) failed in test_2layer_routing`);
  }
}

runTests();
