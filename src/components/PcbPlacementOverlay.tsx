import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PcbLayoutResult, PcbViewSide, Rotation } from '../utils/pcbExporter';

/**
 * Dragging a part around the board preview.
 *
 * A transparent layer over the rendered board rather than a second rendering
 * of it: the preview is an SVG string built by the exporter, and the one
 * picture everybody looks at should stay the one the mill is actually being
 * told to cut. This draws nothing but courtyards and handles, in the same
 * viewBox, so a part's outline here sits exactly over its copper there.
 *
 * Pointer positions come back through the SVG's own screen matrix, so the pan
 * and zoom of the container underneath are already accounted for and this
 * never has to know about them.
 */

export interface PcbPlacementOverlayProps {
  result: PcbLayoutResult;
  /** Which face is being shown, because two of them are mirrored in X. */
  view: PcbViewSide;
  /**
   * Where the part was dropped, in board-frame mm — measured from the board's
   * lower-left corner, in the frame of the board as drawn.
   */
  onMove: (componentId: string, xMm: number, yMm: number, rotationDeg: Rotation) => void;
  /** Locked while the board behind it is being rebuilt. */
  busy?: boolean;
  className?: string;
}

/** Placement is to a tenth of a millimetre; below that is noise on a mill. */
const SNAP_MM = 0.1;
const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM;

const quarterTurn = (r: Rotation): Rotation => (((r + 90) % 360) as Rotation);

export const PcbPlacementOverlay: React.FC<PcbPlacementOverlayProps> = ({
  result,
  view,
  onMove,
  busy = false,
  className = '',
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  /** Where the part being dragged currently sits, in program coordinates. */
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; grabDx: number; grabDy: number } | null>(null);

  const o = result.boardOriginMm;
  const vw = result.boardWidthMm + o * 2;
  const vh = result.boardHeightMm + o * 2;

  // The same mapping `renderPcbSvg` draws with: machine Y climbs away from the
  // operator, SVG Y climbs down the screen, and two of the four views are
  // looked at through the board.
  const flipX = view === 'component' || view === 'bottom';
  const px = (x: number) => (flipX ? vw - x : x);
  const py = (y: number) => vh - y;
  // Both mappings are their own inverse, which is why there is only one pair.

  /** Parts worth offering: a wire jumper is the router's, not the user's. */
  const parts = useMemo(
    () => result.components.filter(c => !c.data?.autoJumper),
    [result.components]
  );

  const pointAt = (e: React.PointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: px(p.x), y: py(p.y) };
  };

  /**
   * Whether the part would land somewhere it can be built, checked as the
   * pointer moves so a bad drop is visible before it is made. The layout
   * engine makes the same judgement again and is the one that counts — this
   * is only here so the outline turns red under the cursor rather than the
   * move being refused after the fact.
   */
  const dropIsLegal = (id: string, x: number, y: number): boolean => {
    const part = parts.find(c => c.id === id);
    if (!part) return false;
    const hw = part.widthMm / 2;
    const hh = part.heightMm / 2;
    if (x - hw < o || y - hh < o || x + hw > o + result.boardWidthMm || y + hh > o + result.boardHeightMm) {
      return false;
    }
    return !result.components.some(
      other =>
        other.id !== id &&
        Math.abs(x - other.x) < (part.widthMm + other.widthMm) / 2 - 0.01 &&
        Math.abs(y - other.y) < (part.heightMm + other.heightMm) / 2 - 0.01
    );
  };

  const commit = (id: string, x: number, y: number, rotationDeg: Rotation) => {
    onMove(id, snap(x - o), snap(y - o), rotationDeg);
  };

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    if (busy || e.button !== 0) return;
    // The container underneath pans on a drag, and this one does not want to.
    e.stopPropagation();
    const at = pointAt(e);
    const part = parts.find(c => c.id === id);
    if (!at || !part) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSelected(id);
    setDrag({ id, x: part.x, y: part.y, grabDx: at.x - part.x, grabDy: at.y - part.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const at = pointAt(e);
    if (!at) return;
    setDrag({ ...drag, x: snap(at.x - drag.grabDx), y: snap(at.y - drag.grabDy) });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const part = parts.find(c => c.id === drag.id);
    const moved = part && (Math.abs(part.x - drag.x) > 1e-6 || Math.abs(part.y - drag.y) > 1e-6);
    if (part && moved && dropIsLegal(drag.id, drag.x, drag.y)) {
      commit(drag.id, drag.x, drag.y, part.rotationDeg);
    }
    setDrag(null);
  };

  // R turns the selected part a quarter turn; Escape puts a drag back.
  //
  // Re-bound every render on purpose: the handler moves the part off the
  // board as it stands *now*, and a dependency list would leave it turning
  // the board that was on screen when the part was first picked up.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrag(null);
        setSelected(null);
        return;
      }
      if (busy || e.key !== 'r' || e.metaKey || e.ctrlKey || e.altKey) return;
      const part = parts.find(c => c.id === selected);
      if (!part) return;
      e.preventDefault();
      commit(part.id, part.x, part.y, quarterTurn(part.rotationDeg));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const legal = drag ? dropIsLegal(drag.id, drag.x, drag.y) : true;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${vw} ${vh}`}
      width="100%"
      height="100%"
      className={`${className} ${busy ? 'cursor-progress' : ''}`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {parts.map(part => {
        const isDragging = drag?.id === part.id;
        const active = selected === part.id || hovered === part.id;
        const x = isDragging ? drag.x : part.x;
        const y = isDragging ? drag.y : part.y;
        const stroke = isDragging
          ? legal
            ? '#22c55e'
            : '#ef4444'
          : active
          ? '#22c55e'
          : 'transparent';
        return (
          <g key={part.id}>
            {/* Where it came from, while it is being carried somewhere else. */}
            {isDragging && (
              <rect
                x={px(part.x) - part.widthMm / 2}
                y={py(part.y) - part.heightMm / 2}
                width={part.widthMm}
                height={part.heightMm}
                fill="none"
                stroke="#22c55e"
                strokeOpacity={0.35}
                strokeWidth={0.15}
                strokeDasharray="0.6 0.4"
              />
            )}
            <rect
              x={px(x) - part.widthMm / 2}
              y={py(y) - part.heightMm / 2}
              width={part.widthMm}
              height={part.heightMm}
              fill={active || isDragging ? '#22c55e' : '#ffffff'}
              fillOpacity={isDragging ? 0.18 : active ? 0.12 : 0.001}
              stroke={stroke}
              strokeWidth={0.2}
              style={{ cursor: busy ? 'progress' : isDragging ? 'grabbing' : 'grab' }}
              onPointerDown={e => handlePointerDown(e, part.id)}
              onPointerEnter={() => setHovered(part.id)}
              onPointerLeave={() => setHovered(h => (h === part.id ? null : h))}
            >
              <title>{`${part.name} — drag to move, R to turn`}</title>
            </rect>
            {active && (
              <text
                x={px(x)}
                y={py(y) - part.heightMm / 2 - 0.5}
                textAnchor="middle"
                fontSize={Math.max(1.2, vw / 60)}
                fill="#22c55e"
                className="font-mono pointer-events-none"
              >
                {part.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};
