import { generatePcbLayout } from './utils/pcbExporter';
import { presets } from './utils/presets';


const preset = presets.heltecCc1101;

const res = generatePcbLayout(preset.nodes as any, preset.edges as any, {
  boardWidthMm: 80,
  boardHeightMm: 80,
  autoGrowBoard: true,
});

console.log('Success:', res.success);
console.log('Completion:', `${(res.completion * 100).toFixed(0)}%`);
console.log('Board:', res.boardWidthMm.toFixed(1), 'x', res.boardHeightMm.toFixed(1));
console.log('Violations:', res.violations);
console.log('Unrouted:', res.unrouted);

console.log('\nComponents:');
for (const c of res.components as any[]) {
  console.log(`  ${c.id} ${c.footprint?.packageId ?? ''} @ (${c.x.toFixed(1)},${c.y.toFixed(1)}) rot=${c.rotationDeg} ` +
    `w=${c.footprint?.bodyWidthMm ?? '?'} h=${c.footprint?.bodyHeightMm ?? '?'}`);
}

console.log('\nPads with nets:');
for (const p of res.pads as any[]) {
  if (!p.netId) continue;
  console.log(`  ${p.componentId}.${p.pinNumber} handle=${p.handleId} net=${p.netId} @ (${p.x.toFixed(2)},${p.y.toFixed(2)}) ` +
    `w=${p.spec.widthMm} h=${p.spec.heightMm}`);
}

console.log('\nAll pads (incl. unnetted, they still block):');
for (const p of res.pads as any[]) {
  console.log(`  ${p.componentId}.${p.pinNumber} net=${p.netId ?? '-'} @ (${p.x.toFixed(2)},${p.y.toFixed(2)})`);
}

console.log('\nTraces:');
for (const t of res.traces as any[]) {
  console.log(`  net=${t.netId} pts=${t.points.map((q: any) => `(${q.x.toFixed(1)},${q.y.toFixed(1)})`).join(' ')}`);
}
