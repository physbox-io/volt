import { presets } from './utils/presets';
import { generatePcbLayout, type PcbLayoutResult } from './utils/pcbExporter';
import { strokeToPoly, unionPolys, polysOverlap, circlePoly, rectPoly, ovalPoly, type Poly } from './utils/pcbGeometry';

function copperOf(r: PcbLayoutResult): Map<string, Poly[]> {
  const m = new Map<string, Poly[]>();
  const add = (n: string, p: Poly[]) => m.set(n, (m.get(n)||[]).concat(p));
  for (const pad of r.pads) {
    if (!pad.netId) continue;
    const c = r.components.find(c=>c.id===pad.componentId)!;
    const rot = c.rotationDeg === 90;
    const w = rot ? pad.spec.padHeight : pad.spec.padWidth;
    const h = rot ? pad.spec.padWidth : pad.spec.padHeight;
    add(pad.netId, [pad.spec.shape==='circle' ? circlePoly(pad.x,pad.y,Math.max(w,h)/2)
      : pad.spec.shape==='oval' ? ovalPoly(pad.x,pad.y,w,h) : rectPoly(pad.x,pad.y,w,h)]);
  }
  for (const t of r.traces) add(t.netId, strokeToPoly(t.points, t.width));
  for (const [k,v] of m) m.set(k, unionPolys(v));
  return m;
}

let totalFail = 0;
for (const [key, p] of Object.entries(presets) as any) {
  if (!p.nodes?.length) continue;
  const t0 = Date.now();
  let r: PcbLayoutResult;
  try { r = generatePcbLayout(p.nodes, p.edges); }
  catch (e:any) { console.log(`${key}: THREW ${e.message}`); totalFail++; continue; }
  const ms = Date.now()-t0;
  const fails: string[] = [];

  // 1. cross-net copper shorts
  const copper = copperOf(r);
  const ids = [...copper.keys()];
  for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++)
    if (polysOverlap(copper.get(ids[i])!, copper.get(ids[j])!, 1e-5)) fails.push(`SHORT ${ids[i]}~${ids[j]}`);

  // 2. isolation toolpath must not cut into another net's copper
  for (const iso of r.isolationPaths) {
    const cut = strokeToPoly(iso.points, r.effectiveToolDiaMm);
    for (const [nid, poly] of copper) {
      if (nid === iso.netId) continue;
      if (polysOverlap(cut, poly, 1e-4)) { fails.push(`ISO-CUTS ${iso.netId} into ${nid}`); break; }
    }
  }

  // 3. components inside board & not overlapping
  for (const c of r.components) {
    if (c.x - c.widthMm/2 < -0.01 || c.y - c.heightMm/2 < -0.01 ||
        c.x + c.widthMm/2 > r.boardWidthMm+0.01 || c.y + c.heightMm/2 > r.boardHeightMm+0.01)
      fails.push(`OOB ${c.name}`);
  }
  for (let i=0;i<r.components.length;i++) for (let j=i+1;j<r.components.length;j++) {
    const a=r.components[i],b=r.components[j];
    if (Math.abs(a.x-b.x) < (a.widthMm+b.widthMm)/2-0.02 && Math.abs(a.y-b.y) < (a.heightMm+b.heightMm)/2-0.02)
      fails.push(`OVERLAP ${a.name}~${b.name}`);
  }

  // 4. traces within board
  for (const t of r.traces) for (const q of t.points)
    if (q.x<0||q.y<0||q.x>r.boardWidthMm||q.y>r.boardHeightMm) { fails.push(`TRACE-OOB ${t.netId}`); break; }

  // 5. gcode structure
  const g = r.gcode;
  const errs = r.violations.filter(v=>v.severity==='error').length;
  if (errs===0) {
    if (!g.includes('G21')) fails.push('no G21');
    if (!g.includes('M30')) fails.push('no M30');
    if (!/M3 S\d+/.test(g)) fails.push('no spindle on');
    if (!g.includes('M5')) fails.push('no spindle off');
    if (/NaN|undefined|Infinity/.test(g)) fails.push('BAD NUMBER in gcode');
  }
  const routedPct = (r.completion*100).toFixed(0);
  const status = fails.length ? `FAIL ${fails.slice(0,3).join('; ')}` : 'ok';
  if (fails.length) totalFail++;
  console.log(`${status==='ok'?'  ':'!!'} ${key.padEnd(28)} ${String(r.components.length).padStart(2)}c ${String(r.nets.length).padStart(2)}n ${String(r.traces.length).padStart(3)}t ${routedPct.padStart(3)}% ${String(r.boardWidthMm)}x${r.boardHeightMm} ${String(ms).padStart(5)}ms  ${errs?`${errs}err `:''}${status}`);
}
console.log(`\n${totalFail} preset(s) with failures`);
