/**
 * Pictures of the schematic: the MCP screenshot, and the thumbnail a save
 * keeps for the circuit browser. One capture so the two cannot drift, and so
 * the wire-paint workaround below applies to both.
 */

import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react';
import { toJpeg, toPng } from 'html-to-image';

/**
 * Margin left around the circuit in a screenshot.
 *
 * As a `px` string, not the bare number: React Flow reads a bare number as a
 * FRACTION of the frame, so a plain 48 asks for 4800% padding and fits the whole
 * circuit into a speck in the middle of the image.
 */
export const PAD = 48;
const PAD_CSS = `${PAD}px` as const;

/**
 * Paint properties that a wire gets from the stylesheet rather than from its
 * own attributes, stamped onto the element for the duration of a capture.
 *
 * html-to-image inlines the computed style of every HTML element it clones,
 * but an SVG subtree is deep-cloned as-is: its children arrive carrying only
 * their class names, and the stylesheet they were painted by is not part of the
 * cloned document. Wire strokes come from `.react-flow .react-flow__edge-path`
 * in index.css — a rule that needs an ancestor two levels above the captured
 * viewport — so every wire in a screenshot came out with SVG's default `stroke:
 * none`: a picture of the components with no connections between them.
 *
 * Writing the value the element already computes to changes nothing on screen;
 * it just survives the clone. Restored in a `finally` either way.
 */
const CAPTURED_SVG_PAINT = [
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'color',
] as const;

function inlineSvgPaint(root: HTMLElement): () => void {
  const touched: { el: SVGElement; prev: string | null }[] = [];
  root.querySelectorAll<SVGElement>('svg *').forEach(el => {
    if (!(el instanceof SVGElement)) return;
    const computed = getComputedStyle(el);
    const prev = el.getAttribute('style');
    let extra = '';
    for (const prop of CAPTURED_SVG_PAINT) {
      const value = computed.getPropertyValue(prop);
      if (value) extra += `${prop}:${value};`;
    }
    if (!extra) return;
    touched.push({ el, prev });
    // Its own inline style stays last, so anything set there still wins.
    el.setAttribute('style', `${extra}${prev ?? ''}`);
  });
  return () => {
    for (const { el, prev } of touched) {
      if (prev === null) el.removeAttribute('style');
      else el.setAttribute('style', prev);
    }
  };
}

/**
 * The whole circuit fitted to a `width` × `height` frame, as a data URL.
 *
 * The frame is the CIRCUIT, not the viewport: what is panned into view is how
 * a person happens to be looking at the canvas. Throws when the canvas is not
 * mounted; callers that can do without the picture catch it.
 */
export async function captureCircuit(
  nodes: Node[],
  { width, height, minZoom = 0.2, format = 'png' }: { width: number; height: number; minZoom?: number; format?: 'png' | 'jpeg' },
): Promise<string> {
  const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewportEl) throw new Error('React Flow canvas is not mounted');
  const dark = document.documentElement.classList.contains('dark');
  const { x, y, zoom } = getViewportForBounds(getNodesBounds(nodes), width, height, minZoom, 2, PAD_CSS);
  const restorePaint = inlineSvgPaint(viewportEl);
  try {
    const options = {
      backgroundColor: dark ? '#0f172a' : '#f8fafc',
      width,
      height,
      // The live element keeps its own pan/zoom transform. Overriding it
      // for the capture is what fits the circuit to the frame; the
      // element on screen is untouched.
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      },
    };
    return format === 'jpeg'
      ? await toJpeg(viewportEl, { ...options, quality: 0.75, pixelRatio: 1 })
      : await toPng(viewportEl, options);
  } finally {
    restorePaint();
  }
}

/** A small 4:3 JPEG of the circuit for the circuit browser, or null when there is nothing to draw. */
export async function captureCircuitThumb(nodes: Node[]): Promise<string | null> {
  if (nodes.length === 0) return null;
  try {
    // Zoomed out as far as it takes: a thumbnail of half a board is no use.
    return await captureCircuit(nodes, { width: 240, height: 180, minZoom: 0.01, format: 'jpeg' });
  } catch {
    return null;
  }
}
