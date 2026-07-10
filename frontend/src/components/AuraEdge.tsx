import { BaseEdge, type EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { useEffect, useState, createContext, useContext, useMemo, useCallback } from 'react';

export const EdgePathContext = createContext<{
  registerPath: (id: string, points: {x: number; y: number}[]) => void;
  unregisterPath: (id: string) => void;
  junctions: {x: number; y: number}[];
} | null>(null);

export function EdgePathProvider({ children, edges = [] }: { children: React.ReactNode; edges?: any[] }) {
  const [paths, setPaths] = useState<Record<string, {x: number; y: number}[]>>({});

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

  const junctions = useMemo(() => {
    const juncs: {x: number; y: number}[] = [];
    const edgeIds = Object.keys(paths);

    // 1. Group edges into connected nets (union-find)
    const parent: Record<string, string> = {};
    const find = (id: string): string => {
      if (!parent[id]) parent[id] = id;
      if (parent[id] === id) return id;
      return parent[id] = find(parent[id]);
    };
    const union = (id1: string, id2: string) => {
      const root1 = find(id1);
      const root2 = find(id2);
      if (root1 !== root2) {
        parent[root1] = root2;
      }
    };

    // Group edges by terminal key: "nodeId/handleId"
    const terminalToEdges: Record<string, string[]> = {};
    edges.forEach(e => {
      const term1 = `${e.source}/${e.sourceHandle || ''}`;
      const term2 = `${e.target}/${e.targetHandle || ''}`;
      if (!terminalToEdges[term1]) terminalToEdges[term1] = [];
      if (!terminalToEdges[term2]) terminalToEdges[term2] = [];
      terminalToEdges[term1].push(e.id);
      terminalToEdges[term2].push(e.id);
    });

    // Union edges that share a terminal
    Object.values(terminalToEdges).forEach(edgeIdsList => {
      for (let i = 1; i < edgeIdsList.length; i++) {
        union(edgeIdsList[0], edgeIdsList[i]);
      }
    });

    // 2. Identify all component terminals (source and target coordinates of all edges)
    // We should not place junction dots at component terminals.
    const terminalCoords: {x: number; y: number}[] = [];
    edgeIds.forEach(id => {
      const pts = paths[id];
      if (pts && pts.length > 0) {
        terminalCoords.push(pts[0]);
        terminalCoords.push(pts[pts.length - 1]);
      }
    });

    const isTerminalCoord = (p: {x: number; y: number}) => {
      return terminalCoords.some(tc => Math.abs(tc.x - p.x) < 1.5 && Math.abs(tc.y - p.y) < 1.5);
    };

    // 3. Convert paths to segments for each edge
    const edgeSegments: Record<string, { p1: {x: number; y: number}; p2: {x: number; y: number} }[]> = {};
    edgeIds.forEach(id => {
      const pts = paths[id];
      const segments: { p1: {x: number; y: number}; p2: {x: number; y: number} }[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push({ p1: pts[i], p2: pts[i + 1] });
      }
      edgeSegments[id] = segments;
    });

    // 4. Find intersections between horizontal segments of one edge and vertical segments of another connected edge
    const candidates: { x: number; y: number; netRoot: string }[] = [];
    const epsilon = 3;

    for (let i = 0; i < edgeIds.length; i++) {
      const id1 = edgeIds[i];
      const segs1 = edgeSegments[id1] || [];

      for (let j = i + 1; j < edgeIds.length; j++) {
        const id2 = edgeIds[j];
        // Only check if they are in the same net
        if (find(id1) !== find(id2)) continue;

        const segs2 = edgeSegments[id2] || [];

        segs1.forEach(s1 => {
          segs2.forEach(s2 => {
            const isS1Horiz = Math.abs(s1.p1.y - s1.p2.y) < 3;
            const isS1Vert = Math.abs(s1.p1.x - s1.p2.x) < 3;
            const isS2Horiz = Math.abs(s2.p1.y - s2.p2.y) < 3;
            const isS2Vert = Math.abs(s2.p1.x - s2.p2.x) < 3;

            if (isS1Horiz && isS2Vert) {
              const x = s2.p1.x;
              const y = s1.p1.y;
              const minX1 = Math.min(s1.p1.x, s1.p2.x);
              const maxX1 = Math.max(s1.p1.x, s1.p2.x);
              const minY2 = Math.min(s2.p1.y, s2.p2.y);
              const maxY2 = Math.max(s2.p1.y, s2.p2.y);

              if (x >= minX1 - epsilon && x <= maxX1 + epsilon && y >= minY2 - epsilon && y <= maxY2 + epsilon) {
                candidates.push({ x, y, netRoot: find(id1) });
              }
            } else if (isS1Vert && isS2Horiz) {
              const x = s1.p1.x;
              const y = s2.p1.y;
              const minY1 = Math.min(s1.p1.y, s1.p2.y);
              const maxY1 = Math.max(s1.p1.y, s1.p2.y);
              const minX2 = Math.min(s2.p1.x, s2.p2.x);
              const maxX2 = Math.max(s2.p1.x, s2.p2.x);

              if (x >= minX2 - epsilon && x <= maxX2 + epsilon && y >= minY1 - epsilon && y <= maxY1 + epsilon) {
                candidates.push({ x, y, netRoot: find(id1) });
              }
            }
          });
        });
      }
    }

    // 5. Filter candidates using topological check
    candidates.forEach(p => {
      if (isTerminalCoord(p)) return;

      const netEdges = edgeIds.filter(id => find(id) === p.netRoot);
      
      let hasLeft = false;
      let hasRight = false;
      let hasUp = false;
      let hasDown = false;

      netEdges.forEach(id => {
        const segs = edgeSegments[id] || [];
        segs.forEach(s => {
          const isHoriz = Math.abs(s.p1.y - s.p2.y) < 3;
          const isVert = Math.abs(s.p1.x - s.p2.x) < 3;

          if (isHoriz) {
            const minY = Math.min(s.p1.y, s.p2.y);
            const minX = Math.min(s.p1.x, s.p2.x);
            const maxX = Math.max(s.p1.x, s.p2.x);

            if (Math.abs(p.y - minY) < 3 && p.x >= minX - 3 && p.x <= maxX + 3) {
              if (minX < p.x - 3) hasLeft = true;
              if (maxX > p.x + 3) hasRight = true;
            }
          } else if (isVert) {
            const minX = Math.min(s.p1.x, s.p2.x);
            const minY = Math.min(s.p1.y, s.p2.y);
            const maxY = Math.max(s.p1.y, s.p2.y);

            if (Math.abs(p.x - minX) < 3 && p.y >= minY - 3 && p.y <= maxY + 3) {
              if (minY < p.y - 3) hasUp = true;
              if (maxY > p.y + 3) hasDown = true;
            }
          }
        });
      });

      const H = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);
      const V = (hasUp ? 1 : 0) + (hasDown ? 1 : 0);

      if (H > 1 || V > 1) {
        if (!juncs.some(j => Math.abs(j.x - p.x) < 3 && Math.abs(j.y - p.y) < 3)) {
          juncs.push(p);
        }
      }
    });

    return juncs;
  }, [paths, edges]);

  const value = useMemo(() => ({ registerPath, unregisterPath, junctions }), [registerPath, unregisterPath, junctions]);

  return (
    <EdgePathContext.Provider value={value}>
      {children}
    </EdgePathContext.Provider>
  );
}

export function AuraEdge({
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
  type,
}: EdgeProps) {
  const defaultOffset = 4;
  let dynamicOffset = defaultOffset;

  const isSourceVert = sourcePosition === 'top' || sourcePosition === 'bottom';
  const isTargetVert = targetPosition === 'top' || targetPosition === 'bottom';

  if (isSourceVert && isTargetVert) {
    const distanceY = Math.abs(targetY - sourceY);
    if (distanceY < 2 * defaultOffset) {
      dynamicOffset = Math.max(2, Math.floor(distanceY / 2) - 1);
    }
  } else if (!isSourceVert && !isTargetVert) {
    const distanceX = Math.abs(targetX - sourceX);
    if (distanceX < 2 * defaultOffset) {
      dynamicOffset = Math.max(2, Math.floor(distanceX / 2) - 1);
    }
  }

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
    borderRadius: 0,
    offset: dynamicOffset,
  });

  const [current, setCurrent] = useState(0);
  
  useEffect(() => {
    const currentArray = data?.current_array as number[] | undefined;
    const timePoints = data?.time_points as number[] | undefined;

    if (!currentArray || !timePoints || timePoints.length === 0) {
      setCurrent(0);
      return;
    }

    let animationFrame: number;
    let startTime = Date.now();
    const duration = timePoints[timePoints.length - 1] || 1000;

    const animate = () => {
      let elapsed = Date.now() - startTime;
      if (elapsed > duration) {
        startTime = Date.now();
        elapsed = 0;
      }

      // Find current at this time
      let idx = 0;
      for (let i = 0; i < timePoints.length; i++) {
        if (timePoints[i] >= elapsed) {
          idx = i;
          break;
        }
      }

      const I = Math.abs(currentArray[idx] || 0);
      setCurrent(I);
      
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [data?.current_array, data?.time_points]);

  const points = useMemo(() => {
    const pts: {x: number; y: number}[] = [];
    const matches = edgePath.matchAll(/[ML]\s*(-?\d+\.?\d*)\s*[\s,]\s*(-?\d+\.?\d*)/g);
    for (const match of matches) {
      pts.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
    }
    return pts;
  }, [edgePath]);

  const context = useContext(EdgePathContext);
  const { registerPath, unregisterPath } = context || {};

  const pointsKey = useMemo(() => JSON.stringify(points), [points]);

  useEffect(() => {
    if (registerPath) {
      registerPath(id, points);
      return () => {
        if (unregisterPath) unregisterPath(id);
      };
    }
  }, [id, pointsKey, registerPath, unregisterPath]);

  const myJunctions = useMemo(() => {
    if (!context) return [];
    
    // Convert current edge points to segments
    const segments: { p1: {x: number; y: number}; p2: {x: number; y: number} }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({ p1: points[i], p2: points[i + 1] });
    }

    // Filter junctions that lie on any of our segments
    return context.junctions.filter(j => {
      return segments.some(s => {
        const isHoriz = Math.abs(s.p1.y - s.p2.y) < 3;
        const isVert = Math.abs(s.p1.x - s.p2.x) < 3;
        if (isHoriz) {
          const minY = Math.min(s.p1.y, s.p2.y);
          const minX = Math.min(s.p1.x, s.p2.x);
          const maxX = Math.max(s.p1.x, s.p2.x);
          return Math.abs(j.y - minY) < 3 && j.x >= minX - 3 && j.x <= maxX + 3;
        } else if (isVert) {
          const minX = Math.min(s.p1.x, s.p2.x);
          const minY = Math.min(s.p1.y, s.p2.y);
          const maxY = Math.max(s.p1.y, s.p2.y);
          return Math.abs(j.x - minX) < 3 && j.y >= minY - 3 && j.y <= maxY + 3;
        }
        return false;
      });
    });
  }, [points, context]);

  const isAuraEnabled = type === 'aura';
  const auraClass = isAuraEnabled
    ? (current > 0.004 ? 'edge-aura' : (current > 0.0001 ? 'edge-aura-faint' : ''))
    : '';

  const strokeColor = auraClass === 'edge-aura'
    ? '#fbbf24'
    : auraClass === 'edge-aura-faint'
    ? '#fcd34d'
    : (style?.stroke as string) || '#555';
  
  return (
    <>
      <BaseEdge 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={style} 
        className={auraClass}
      />
      {myJunctions.map((pt, idx) => (
        <circle 
          key={idx}
          cx={pt.x} 
          cy={pt.y} 
          r={2} 
          fill={strokeColor}
          style={{ pointerEvents: 'none' }}
        />
      ))}
    </>
  );
}
