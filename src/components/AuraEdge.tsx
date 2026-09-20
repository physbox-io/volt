import {
  BaseEdge,
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
  useReactFlow,
} from '@xyflow/react';
import { useEffect, useState, useContext, useMemo, useCallback, memo } from 'react';
import { playbackTicker, findIndexForTime } from '../utils/playbackTicker';
import { getHandleCoord } from '../utils/nodeGeometry';
import { EdgePathContext } from './edgePathContext';
import { useCanvasState } from './canvasState';
import { formatVolts } from '../utils/analysisResults';
import {
  getSchematicPath,
  getOrthogonalPathThroughWaypoint,
  pathNearPoint,
} from '../utils/edgeRouting';

// The part dimensions and the orthogonal router used to live here, under the
// component. A file that exports anything besides components loses React Fast
// Refresh, and on this canvas a full reload throws away the running simulation
// and the view being edited, so they are in `../utils/edgeRouting.ts` now and
// the context object is in `./edgePathContext.ts`.

// Junction dots are owned entirely by JunctionNode.tsx: every real electrical
// T-tap in this app is created via the wire-drop-splice flow in App.tsx,
// which always inserts an explicit `type: 'junction'` node (JunctionNode
// renders its own dot). AuraEdge previously also tried to *infer* junction
// dots from where same-net wire paths geometrically crossed, but that was
// never able to trigger at a real JunctionNode (terminal coordinates were
// explicitly excluded) — it only produced false positives/negatives at
// incidental A* route crossings. That inference has been removed; if a
// future code path ever merges 3+ wires onto a net without going through a
// JunctionNode, dots for that case won't appear.

export function EdgePathProvider({ children }: { children: React.ReactNode; edges?: Edge[] }) {
  const [paths, setPaths] = useState<Record<string, {x: number; y: number}[]>>({});
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const registerPath = useCallback((id: string, points: {x: number; y: number}[]) => {
    setPaths(prev => {
      if (JSON.stringify(prev[id]) === JSON.stringify(points)) return prev;
      return { ...prev, [id]: points };
    });
  }, []);

  const unregisterPath = useCallback((id: string) => {
    setPaths(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    registerPath,
    unregisterPath,
    paths,
    hoveredEdgeId,
    setHoveredEdgeId
  }), [registerPath, unregisterPath, paths, hoveredEdgeId]);

  return (
    <EdgePathContext.Provider value={value}>
      {children}
    </EdgePathContext.Provider>
  );
}


export const AuraEdge = memo(function AuraEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    style = {},
    markerEnd,
    source,
    target,
  } = props;
  // React Flow renamed these between versions and still passes both on some
  // edges, so read either. Neither name is on the published EdgeProps type —
  // `sourceHandle`/`targetHandle` are on `Edge` but are dropped from the props
  // the component is handed, so both have to be named here or `tsc -b` fails.
  const legacyProps = props as EdgeProps & {
    sourceHandleId?: string | null;
    targetHandleId?: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  };
  const sourceHandle = legacyProps.sourceHandleId || legacyProps.sourceHandle;
  const targetHandle = legacyProps.targetHandleId || legacyProps.targetHandle;

  const { setEdges, screenToFlowPosition, getViewport, getEdges, getNodes } = useReactFlow();
  
  // Calculate distinct index for overlapping/sharing terminals to prevent wire overlaps
  const allEdges = getEdges();
  const allNodes = getNodes();
  
  const sharingSource = allEdges
    .filter(e => e.source === source && (e.sourceHandle === sourceHandle || (e as Edge & { sourceHandleId?: string | null }).sourceHandleId === sourceHandle))
    .map(e => e.id)
    .sort();
  const sourceIndex = Math.max(0, sharingSource.indexOf(id));

  const sharingTarget = allEdges
    .filter(e => e.target === target && (e.targetHandle === targetHandle || (e as Edge & { targetHandleId?: string | null }).targetHandleId === targetHandle))
    .map(e => e.id)
    .sort();
  const targetIndex = Math.max(0, sharingTarget.indexOf(id));

  const minWireGap = 24;

  // Find the edge incoming to our source handle
  const incomingEdge = allEdges.find(e =>
    e.target === source &&
    (e.targetHandle === sourceHandle || (e as Edge & { targetHandleId?: string | null }).targetHandleId === sourceHandle)
  );

  let sourceOffset = minWireGap;
  if (incomingEdge) {
    // Get the source and target node of the incoming edge to see if they are facing
    const incSrcNode = allNodes.find(n => n.id === incomingEdge.source);
    const incTgtNode = allNodes.find(n => n.id === incomingEdge.target);
    if (incSrcNode && incTgtNode) {
      const incSrcOrient = incSrcNode.data?.orientation || 'horizontal';
      const incTgtOrient = incTgtNode.data?.orientation || 'horizontal';
      const incSrcVert = incSrcNode.type === 'timer555' ? false : (incSrcOrient === 'vertical' || incSrcOrient === 'up');
      const incTgtVert = incTgtNode.type === 'timer555' ? false : (incTgtOrient === 'vertical' || incTgtOrient === 'up');
      
      if (incSrcVert === incTgtVert) {
        // Facing connection — get their actual handle coordinates
        const pSrc = getHandleCoord(incSrcNode, incomingEdge.sourceHandle || 'out');
        const pTgt = getHandleCoord(incTgtNode, incomingEdge.targetHandle || 'in');
        
        if (incSrcVert) {
          sourceOffset = Math.abs(pSrc.y - pTgt.y) / 2;
        } else {
          sourceOffset = Math.abs(pSrc.x - pTgt.x) / 2;
        }
      }
    }
  }

  const waypoints: { x: number; y: number }[] = useMemo(() => (data?.waypoints as { x: number; y: number }[] | undefined) || [], [data]);
  const [isDragging, setIsDragging] = useState(false);

  const context = useContext(EdgePathContext);
  const { registerPath, unregisterPath } = context || {};

  const edgePath = useMemo(() => {
    const direct = getSchematicPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetPosition,
      targetX,
      targetY,
      sourceOffset,
      sourceIndex,
      targetIndex,
      nodes: allNodes,
      sourceId: source,
      targetId: target,
      edgeId: id,
      allEdges,
      otherEdgesPaths: context?.paths || {},
    });

    if (waypoints.length > 0) {
      // A wire whose pins already have a clear straight run between them has
      // nothing to route around, and both ends are pinned — so any waypoint can
      // only bend it into a pointless U. Dragging such a wire does nothing
      // rather than making the schematic worse.
      const isStraightRun = (direct.match(/[ML]/g) || []).length === 2;
      if (!isStraightRun) {
        return getOrthogonalPathThroughWaypoint(
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          waypoints[0],
          allNodes,
          source,
          target,
        );
      }
    }

    return direct;
  }, [
    waypoints, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    sourceOffset, sourceIndex, targetIndex, allNodes, source, target, id, allEdges,
    context?.paths,
  ]);


  const currentArray = data?.current_array as number[] | undefined;
  const timePoints = data?.time_points as number[] | undefined;
  const hasTrace = !!currentArray && !!timePoints && timePoints.length > 0;

  const [tickedCurrent, setTickedCurrent] = useState(0);

  useEffect(() => {
    if (!hasTrace) return;
    const unsubscribe = playbackTicker.subscribe((elapsed) => {
      const idx = findIndexForTime(timePoints, elapsed);
      setTickedCurrent(Math.abs(currentArray[idx] || 0));
    });
    return unsubscribe;
  }, [hasTrace, currentArray, timePoints]);

  // An edge with no trace carries no current, so that is read off `hasTrace`
  // rather than written back with a setState the effect used to fire on every
  // mount — the value is derived, and the effect is only the subscription.
  const current = hasTrace ? tickedCurrent : 0;

  const points = useMemo(() => {
    const pts: {x: number; y: number}[] = [];
    const matches = edgePath.matchAll(/[ML]\s*(-?\d+\.?\d*)\s*[\s,]\s*(-?\d+\.?\d*)/g);
    for (const match of matches) {
      pts.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
    }
    return pts;
  }, [edgePath]);

  useEffect(() => {
    if (registerPath) {
      registerPath(id, points);
      return () => {
        if (unregisterPath) unregisterPath(id);
      };
    }
    // `points` itself rather than a JSON key of it: it is memoised on the path
    // string, and `registerPath` already discards a re-registration that is
    // structurally identical, so the key bought nothing but a missing dep.
  }, [id, points, registerPath, unregisterPath]);

  /*
   * The DC overlay's chip.
   *
   * Written onto one wire per net by the operating-point solve, so a rail
   * reaching six parts is labelled once rather than six times. It is placed at
   * the halfway point along the wire as drawn — not the midpoint of its two
   * ends, which for an L-shaped route is a spot the wire never passes through.
   */
  const dcVoltage = data?.dcVoltage as number | undefined;
  const dcLabelPoint = (() => {
    if (dcVoltage === undefined || points.length === 0) return null;
    if (points.length === 1) return points[0];
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (total === 0) return points[0];
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
      const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      if (walked + seg >= total / 2) {
        const k = seg === 0 ? 0 : (total / 2 - walked) / seg;
        return {
          x: points[i - 1].x + (points[i].x - points[i - 1].x) * k,
          y: points[i - 1].y + (points[i].y - points[i - 1].y) * k,
        };
      }
      walked += seg;
    }
    return points[points.length - 1];
  })();

  const { showAura } = useCanvasState();
  const isAuraEnabled = showAura;
  const auraClass = isAuraEnabled
    ? (current > 0.004 ? 'edge-aura' : (current > 0.0001 ? 'edge-aura-faint' : ''))
    : '';

  const isHovered = context?.hoveredEdgeId === id;

  // Same-net wires deliberately route on top of each other (trunk sharing),
  // so "the wire" under the cursor is often a bundle of edges. Any waypoint
  // interaction has to hit every bundled edge at the grab point — moving just
  // one used to peel it out of the bundle, leaving two wires drawn for the
  // same net ("dragging the rail split it in two").
  const collectBundleIds = useCallback((clickPos: { x: number; y: number }) => {
    const ids = new Set<string>([id]);
    const paths = context?.paths || {};
    const myPorts = new Set([
      `${source}-${sourceHandle || 'out'}`,
      `${target}-${targetHandle || 'in'}`,
    ]);
    for (const e of getEdges()) {
      if (e.id === id) continue;
      const a = `${e.source}-${e.sourceHandle || 'out'}`;
      const b = `${e.target}-${e.targetHandle || 'in'}`;
      if (!myPorts.has(a) && !myPorts.has(b)) continue;
      const pts = paths[e.id];
      if (pts && pathNearPoint(pts, clickPos, 8)) ids.add(e.id);
    }
    return ids;
  }, [id, source, target, sourceHandle, targetHandle, context?.paths, getEdges]);

  const handleWireMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);

    const startX = e.clientX;
    const startY = e.clientY;

    const clickPos = screenToFlowPosition({ x: startX, y: startY });
    const bundleIds = collectBundleIds(clickPos);

    const initialW = waypoints[0] || { x: clickPos.x, y: clickPos.y };
    const initialX = initialW.x;
    const initialY = initialW.y;

    const { zoom } = getViewport();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      const flowDx = dx / zoom;
      const flowDy = dy / zoom;

      const newX = Math.round((initialX + flowDx) / 4) * 4;
      const newY = Math.round((initialY + flowDy) / 4) * 4;

      setEdges((eds: Edge[]) => eds.map(edge => {
        if (!bundleIds.has(edge.id)) return edge;
        return {
          ...edge,
          data: {
            ...edge.data,
            waypoints: [{ x: newX, y: newY }]
          }
        };
      }));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [waypoints, screenToFlowPosition, getViewport, setEdges, collectBundleIds]);

  const handleWireDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const clickPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const bundleIds = collectBundleIds(clickPos);

    setEdges((eds: Edge[]) => eds.map(edge => {
      if (!bundleIds.has(edge.id)) return edge;
      return {
        ...edge,
        data: {
          ...edge.data,
          waypoints: []
        }
      };
    }));
  }, [setEdges, screenToFlowPosition, collectBundleIds]);
  
  return (
    <>
      <BaseEdge 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={isHovered ? { 
          ...style, 
          stroke: '#10b981', 
          strokeWidth: 4,
          transition: 'stroke 0.15s ease, stroke-width 0.15s ease'
        } : style} 
        className={auraClass}
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={15}
        style={{ cursor: isDragging ? 'grabbing' : 'grab', pointerEvents: 'all' }}
        onMouseDown={handleWireMouseDown}
        onDoubleClick={handleWireDoubleClick}
      />
      {dcVoltage !== undefined && dcLabelPoint && (
        <EdgeLabelRenderer>
          {/* Never a hit target: the wire underneath is draggable, and a chip
              that swallowed the grab would make the rail with the label on it
              the one wire that could not be moved. */}
          <div
            className="nodrag nopan absolute px-1 py-[1px] rounded-[3px] text-[9px] font-mono font-semibold bg-sky-50/95 dark:bg-sky-950/90 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 shadow-xs"
            style={{
              transform: `translate(-50%, -50%) translate(${dcLabelPoint.x}px, ${dcLabelPoint.y}px)`,
              pointerEvents: 'none',
            }}
          >
            {formatVolts(dcVoltage)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
