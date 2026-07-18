import type { Node, Edge } from '@xyflow/react';
import { getHandleCoord, getHandlesForNode, findNearestEdgeAtPoint } from './nodeGeometry';

export function buildPortAdjacency(nodes: Node[], edges: Edge[], skipEdgeId?: string): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  
  const addAdjacency = (p1: string, p2: string) => {
    if (!adj[p1]) adj[p1] = [];
    if (!adj[p2]) adj[p2] = [];
    adj[p1].push(p2);
    adj[p2].push(p1);
  };

  // 1. Add edges
  edges.forEach(edge => {
    if (edge.id === skipEdgeId) return;
    const p1 = `${edge.source}-${edge.sourceHandle || 'out'}`;
    const p2 = `${edge.target}-${edge.targetHandle || 'in'}`;
    addAdjacency(p1, p2);
  });

  // 2. Add internal short connections for junction nodes
  nodes.forEach(node => {
    if (node.type === 'junction') {
      const p1 = `${node.id}-in`;
      const p2 = `${node.id}-out`;
      addAdjacency(p1, p2);
    }
  });

  // 3. Connect all ground node ports to a virtual global ground port 'GND-global'
  const groundNodes = nodes.filter(n => n.type === 'ground');
  groundNodes.forEach(gNode => {
    const p1 = `${gNode.id}-in`;
    const p2 = `GND-global`;
    addAdjacency(p1, p2);
  });
  
  return adj;
}

export function isPortConnected(
  portA: string,
  portB: string,
  nodes: Node[],
  edges: Edge[],
  skipEdgeId?: string
): boolean {
  if (portA === portB) return true;
  const adj = buildPortAdjacency(nodes, edges, skipEdgeId);
  if (!adj[portA] || !adj[portB]) return false;

  const visited = new Set<string>();
  const queue = [portA];
  visited.add(portA);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === portB) return true;
    const neighbors = adj[curr] || [];
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

export function simplifyEdges(nodes: Node[], edges: Edge[]): Edge[] {
  const activeEdges = [...edges];
  const keepEdges: Edge[] = [];
  
  for (const edge of edges) {
    const portA = `${edge.source}-${edge.sourceHandle || 'out'}`;
    const portB = `${edge.target}-${edge.targetHandle || 'in'}`;
    
    // Check if portA and portB are connected in the graph consisting of:
    // keepEdges + remaining edges in edges (excluding the current edge)
    const otherEdges = [
      ...keepEdges,
      ...activeEdges.filter(e => e.id !== edge.id && !keepEdges.includes(e))
    ];
    
    if (isPortConnected(portA, portB, nodes, otherEdges)) {
      // It is redundant! We don't add it to keepEdges, and we remove it from activeEdges
      const idx = activeEdges.findIndex(e => e.id === edge.id);
      if (idx !== -1) {
        activeEdges.splice(idx, 1);
      }
    } else {
      keepEdges.push(edge);
    }
  }
  
  return keepEdges;
}

export function mergeOverlappingNodesAndJunctions(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
  let updatedNodes = [...nodes];
  let updatedEdges = [...edges];

  // Find all junctions
  const junctions = updatedNodes.filter(n => n.type === 'junction');
  
  for (const junc of junctions) {
    // Check if it's close to another junction
    const otherJunc = updatedNodes.find(n => n.type === 'junction' && n.id !== junc.id && 
      Math.hypot(n.position.x - junc.position.x, n.position.y - junc.position.y) < 12
    );
    
    if (otherJunc) {
      // Merge junc into otherJunc
      updatedEdges = updatedEdges.map(edge => {
        let updated = { ...edge };
        if (edge.source === junc.id) {
          updated.source = otherJunc.id;
          updated.sourceHandle = 'out';
        }
        if (edge.target === junc.id) {
          updated.target = otherJunc.id;
          updated.targetHandle = 'in';
        }
        return updated;
      }).filter(edge => {
        return edge.source !== edge.target;
      });
      
      updatedNodes = updatedNodes.filter(n => n.id !== junc.id);
      continue;
    }

    // Check if it's close to a non-junction component handle
    let mergedToHandle = false;
    for (const node of updatedNodes) {
      if (node.type === 'junction') continue;
      const handles = getHandlesForNode(node);
      for (const handle of handles) {
        const coord = getHandleCoord(node, handle);
        if (Math.hypot(coord.x - junc.position.x, coord.y - junc.position.y) < 12) {
          // Merge junction junc into this handle
          updatedEdges = updatedEdges.map(edge => {
            let updated = { ...edge };
            if (edge.source === junc.id) {
              updated.source = node.id;
              updated.sourceHandle = handle;
            }
            if (edge.target === junc.id) {
              updated.target = node.id;
              updated.targetHandle = handle;
            }
            return updated;
          }).filter(edge => {
            return edge.source !== edge.target;
          });
          
          updatedNodes = updatedNodes.filter(n => n.id !== junc.id);
          mergedToHandle = true;
          break;
        }
      }
      if (mergedToHandle) break;
    }
  }

  // Also check if any ground node is close to another ground node
  const grounds = updatedNodes.filter(n => n.type === 'ground');
  for (const g of grounds) {
    const otherG = updatedNodes.find(n => n.type === 'ground' && n.id !== g.id && 
      Math.hypot(n.position.x - g.position.x, n.position.y - g.position.y) < 12
    );
    if (otherG) {
      updatedEdges = updatedEdges.map(edge => {
        let updated = { ...edge };
        if (edge.source === g.id) {
          updated.source = otherG.id;
        }
        if (edge.target === g.id) {
          updated.target = otherG.id;
        }
        return updated;
      }).filter(edge => edge.source !== edge.target);
      
      updatedNodes = updatedNodes.filter(n => n.id !== g.id);
    }
  }

  return { nodes: updatedNodes, edges: updatedEdges };
}

export function splitEdgesOnOverlappingNodes(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
  let updatedNodes = [...nodes];
  let updatedEdges = [...edges];

  const connectableNodes = updatedNodes.filter(n => n.type === 'junction' || n.type === 'ground');

  for (const node of connectableNodes) {
    const match = findNearestEdgeAtPoint(updatedNodes, updatedEdges, node.position, node.id, 8);
    const matchedEdge = match?.edge ?? null;

    if (matchedEdge) {
      const edgeType = matchedEdge.type || 'aura';

      if (node.type === 'junction') {
        const edgeToJunction: Edge = {
          id: `e-${matchedEdge.source}-${node.id}-${Date.now()}`,
          source: matchedEdge.source,
          sourceHandle: matchedEdge.sourceHandle,
          target: node.id,
          targetHandle: 'in',
          type: edgeType,
        };

        const edgeFromJunction: Edge = {
          id: `e-${node.id}-${matchedEdge.target}-${Date.now()}`,
          source: node.id,
          sourceHandle: 'out',
          target: matchedEdge.target,
          targetHandle: matchedEdge.targetHandle,
          type: edgeType,
        };

        updatedEdges = [
          ...updatedEdges.filter(e => e.id !== matchedEdge.id),
          edgeToJunction,
          edgeFromJunction
        ];
      } 
      else if (node.type === 'ground') {
        const edgeToGround: Edge = {
          id: `e-${matchedEdge.source}-${node.id}-${Date.now()}`,
          source: matchedEdge.source,
          sourceHandle: matchedEdge.sourceHandle,
          target: node.id,
          targetHandle: 'in',
          type: edgeType,
        };

        const edgeFromGround: Edge = {
          id: `e-${node.id}-${matchedEdge.target}-${Date.now()}`,
          source: node.id,
          sourceHandle: 'in',
          target: matchedEdge.target,
          targetHandle: matchedEdge.targetHandle,
          type: edgeType,
        };

        updatedEdges = [
          ...updatedEdges.filter(e => e.id !== matchedEdge.id),
          edgeToGround,
          edgeFromGround
        ];
      }
    }
  }

  return { nodes: updatedNodes, edges: updatedEdges };
}
