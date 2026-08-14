import { useState, useCallback, useEffect, useRef, useContext, type DragEvent } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  type Node,
  type Edge,
  useReactFlow,
  ConnectionMode,
  getNodesBounds,
} from '@xyflow/react';

import { ResistorNode } from './nodes/ResistorNode';
import { VoltageNode } from './nodes/VoltageNode';
import { GroundNode } from './nodes/GroundNode';
import { LEDNode } from './nodes/LEDNode';
import { CapacitorNode } from './nodes/CapacitorNode';
import { Timer555Node } from './nodes/Timer555Node';
import { OpAmpNode } from './nodes/OpAmpNode';
import { MultimeterNode } from './nodes/MultimeterNode';
import { SignalGeneratorNode } from './nodes/SignalGeneratorNode';
import { ScopeNode } from './nodes/ScopeNode';
import { SpeakerNode } from './nodes/SpeakerNode';
import { MicrophoneNode } from './nodes/MicrophoneNode';
import { NpnNode } from './nodes/NpnNode';
import { PnpNode } from './nodes/PnpNode';
import { NmosNode } from './nodes/NmosNode';
import { PmosNode } from './nodes/PmosNode';
import { DiodeNode } from './nodes/DiodeNode';
import { ZenerDiodeNode } from './nodes/ZenerDiodeNode';
import { ACVoltageNode } from './nodes/ACVoltageNode';
import { MicrocontrollerNode } from './nodes/MicrocontrollerNode';
import { HeltecV4Node } from './nodes/HeltecV4Node';
import { nodeRegistry } from './nodes/registry';
import { AndNode } from './nodes/AndNode';
import { OrNode } from './nodes/OrNode';
import { NotNode } from './nodes/NotNode';
import { NandNode } from './nodes/NandNode';
import { NorNode } from './nodes/NorNode';
import { XorNode } from './nodes/XorNode';
import { InductorNode } from './nodes/InductorNode';
import { SwitchNode } from './nodes/SwitchNode';
import { PotentiometerNode } from './nodes/PotentiometerNode';
import { SevenSegmentNode } from './nodes/SevenSegmentNode';
import { CurrentSourceNode } from './nodes/CurrentSourceNode';
import { TransformerNode } from './nodes/TransformerNode';
import { DFlipFlopNode } from './nodes/DFlipFlopNode';
import { LDRNode } from './nodes/LDRNode';
import { JunctionNode } from './nodes/JunctionNode';
import { AuraEdge, EdgePathContext } from './AuraEdge';
import { findNearestEdgeAtPoint } from '../utils/nodeGeometry';
import { isPortConnected, mergeOverlappingNodesAndJunctions, splitEdgesOnOverlappingNodes, simplifyEdges } from '../utils/graphTopology';

const edgeTypes = {
  aura: AuraEdge,
  smoothstep: AuraEdge,
  straight: AuraEdge,
  step: AuraEdge,
};

const nodeTypes = {
  resistor: ResistorNode,
  voltage: VoltageNode,
  ground: GroundNode,
  led: LEDNode,
  capacitor: CapacitorNode,
  timer555: Timer555Node,
  opamp: OpAmpNode,
  multimeter: MultimeterNode,
  signalgen: SignalGeneratorNode,
  scope: ScopeNode,
  speaker: SpeakerNode,
  microphone: MicrophoneNode,
  npn: NpnNode,
  pnp: PnpNode,
  nmos: NmosNode,
  pmos: PmosNode,
  diode: DiodeNode,
  zener: ZenerDiodeNode,
  acvoltage: ACVoltageNode,
  mcu: MicrocontrollerNode,
  heltec_v4: HeltecV4Node,
  and: AndNode,
  or: OrNode,
  not: NotNode,
  nand: NandNode,
  nor: NorNode,
  xor: XorNode,
  inductor: InductorNode,
  switch: SwitchNode,
  potentiometer: PotentiometerNode,
  sevenseg: SevenSegmentNode,
  currentsource: CurrentSourceNode,
  transformer: TransformerNode,
  dff: DFlipFlopNode,
  ldr: LDRNode,
  junction: JunctionNode,
};

let nodeId = 1;

export function FlowArea({
  nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, onConnect, onNodeClick,
  probeMode, onEdgeProbe, isSimulating, fitKey, hasNoteCard, noteCardRect
}: any) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getViewport, setViewport, getNodes } = useReactFlow();
  // Supplied by App so FlowArea doesn't need to know how note cards are rendered.
  const cardRectRef = useRef<(() => DOMRect | null) | null>(null);
  cardRectRef.current = noteCardRect ?? null;

  // `fitView` as a prop only runs on mount, so every preset after the first was
  // framed by whatever fit the *previous* circuit — usually a zoomed-in corner
  // with wires running off every edge. Re-frame whenever the circuit identity
  // changes (not on node drags, which keep the same fitKey).
  //
  // This centres into an explicit rect rather than calling fitView, because the
  // note card is a 300px overlay pinned top-right: fitView's asymmetric padding
  // shrinks the circuit but still centres it across the whole pane, so a tall
  // circuit slides back under the card.
  useEffect(() => {
    if (!nodes.length) return;
    // One frame's delay: custom nodes must measure before their extents are known.
    const raf = requestAnimationFrame(() => {
      const pane = reactFlowWrapper.current;
      if (!pane) return;
      const paneRect = pane.getBoundingClientRect();
      const bounds = getNodesBounds(getNodes());
      if (!bounds.width || !bounds.height) return;

      const M = 24;
      const cardRect = hasNoteCard ? cardRectRef.current?.() : null;

      const frame = (reserveRight: number) => {
        const availW = Math.max(80, paneRect.width - M * 2 - reserveRight);
        const availH = Math.max(80, paneRect.height - M * 2);
        const zoom = Math.min(availW / bounds.width, availH / bounds.height, 1.5);
        return {
          zoom,
          x: M + (availW - bounds.width * zoom) / 2 - bounds.x * zoom,
          y: M + (availH - bounds.height * zoom) / 2 - bounds.y * zoom,
        };
      };

      // Prefer the whole pane; only give up the card's column when the circuit
      // would actually collide with it. (Dropping the circuit *below* the card
      // instead uses the width better, but pushes tall circuits off the bottom
      // — keeping everything on screen matters more than filling it.)
      let vp = frame(0);
      if (cardRect) {
        const right = paneRect.left + vp.x + (bounds.x + bounds.width) * vp.zoom;
        const top = paneRect.top + vp.y + bounds.y * vp.zoom;
        if (right > cardRect.left && top < cardRect.bottom) {
          vp = frame(paneRect.right - cardRect.left + 12);
        }
      }
      setViewport(vp, { duration: 200 });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, hasNoteCard]);

  const context = useContext(EdgePathContext);
  const setHoveredEdgeId = context?.setHoveredEdgeId;

  const [previewJunction, setPreviewJunction] = useState<{ x: number; y: number } | null>(null);
  const connectingStartRef = useRef<{ nodeId: string; handleId: string; handleType: string } | null>(null);

  const onConnectStart = useCallback((_event: any, { nodeId, handleId, handleType }: any) => {
    connectingStartRef.current = { nodeId, handleId, handleType };
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!connectingStartRef.current || !setHoveredEdgeId) {
      if (previewJunction) setPreviewJunction(null);
      if (context?.hoveredEdgeId) setHoveredEdgeId(null);
      return;
    }

    const dropPoint = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const match = findNearestEdgeAtPoint(nodes, edges, dropPoint, connectingStartRef.current.nodeId, 16);

    if (match) {
      setPreviewJunction(match.projectionPoint);
      setHoveredEdgeId(match.edge.id);
    } else {
      setPreviewJunction(null);
      setHoveredEdgeId(null);
    }
  }, [nodes, edges, screenToFlowPosition, setHoveredEdgeId, context?.hoveredEdgeId, previewJunction]);

  const onConnectEnd = useCallback((event: any) => {
    if (setHoveredEdgeId) setHoveredEdgeId(null);
    setPreviewJunction(null);

    if (!connectingStartRef.current) return;

    // Get drop point screen coordinates
    let clientX = 0;
    let clientY = 0;
    if (event.clientX !== undefined) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
      clientX = event.changedTouches[0].clientX;
      clientY = event.changedTouches[0].clientY;
    } else {
      connectingStartRef.current = null;
      return;
    }

    // Check if clientX, clientY are within ReactFlow bounds
    if (!reactFlowWrapper.current) {
      connectingStartRef.current = null;
      return;
    }

    // Check if the drop target was a react-flow pane or canvas, or if it dropped on a handle/node
    const target = event.target as HTMLElement;
    const isPaneOrEdge = target.classList.contains('react-flow__pane') || 
                         target.classList.contains('react-flow__edge') || 
                         target.classList.contains('react-flow__edge-path') ||
                         target.closest('.react-flow__edge');
                         
    if (!isPaneOrEdge) {
      connectingStartRef.current = null;
      return;
    }

    // Convert drop coordinates to flow coordinates
    const dropPoint = screenToFlowPosition({ x: clientX, y: clientY });

    // Find if the drop point is close to any existing edge
    const edgeMatch = findNearestEdgeAtPoint(nodes, edges, dropPoint, connectingStartRef.current.nodeId, 16);
    const matchedEdge: any = edgeMatch?.edge ?? null;
    const projectionPoint = edgeMatch?.projectionPoint ?? { x: Math.round(dropPoint.x / 8) * 8, y: Math.round(dropPoint.y / 8) * 8 };

    if (matchedEdge) {
      // Check for redundancy first
      const draggedNodeId = connectingStartRef.current.nodeId;
      const draggedHandleId = connectingStartRef.current.handleId;
      const draggedHandleType = connectingStartRef.current.handleType;
      const draggedPort = `${draggedNodeId}-${draggedHandleId || (draggedHandleType === 'source' ? 'out' : 'in')}`;
      const sourcePortOfEdge = `${matchedEdge.source}-${matchedEdge.sourceHandle || 'out'}`;
      if (isPortConnected(draggedPort, sourcePortOfEdge, nodes, edges)) {
        alert("Connection is redundant (these points are already electrically connected).");
        connectingStartRef.current = null;
        return;
      }

      // Split the matchedEdge by creating a new junction node
      const junctionId = `junction-${Date.now()}`;
      const newJunctionNode: any = {
        id: junctionId,
        type: 'junction',
        position: projectionPoint,
        data: {},
      };

      const edgeType = matchedEdge.type || 'aura';

      // Create new edges — preserve original edge type and style
      const edgeToJunction: any = {
        id: `e-${matchedEdge.source}-${junctionId}`,
        source: matchedEdge.source,
        sourceHandle: matchedEdge.sourceHandle,
        target: junctionId,
        targetHandle: 'in',
        type: edgeType,
      };

      const edgeFromJunction: any = {
        id: `e-${junctionId}-${matchedEdge.target}`,
        source: junctionId,
        sourceHandle: 'out',
        target: matchedEdge.target,
        targetHandle: matchedEdge.targetHandle,
        type: edgeType,
      };

      // Edge from the dragged handle to junction
      const newConnectionEdge: any = draggedHandleType === 'source' ? {
        id: `e-${draggedNodeId}-${junctionId}`,
        source: draggedNodeId,
        sourceHandle: draggedHandleId,
        target: junctionId,
        targetHandle: 'in',
        type: edgeType,
      } : {
        id: `e-${junctionId}-${draggedNodeId}`,
        source: junctionId,
        sourceHandle: 'out',
        target: draggedNodeId,
        targetHandle: draggedHandleId,
        type: edgeType,
      };

      // Update state
      setNodes((nds: any[]) => [...nds, newJunctionNode]);
      setEdges((eds: any[]) => [
        ...eds.filter(e => e.id !== matchedEdge.id),
        edgeToJunction,
        edgeFromJunction,
        newConnectionEdge
      ]);
    }

    connectingStartRef.current = null;
  }, [nodes, edges, setNodes, setEdges, screenToFlowPosition, setHoveredEdgeId]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      if (isSimulating) return;
      const type = event.dataTransfer.getData('application/reactflow');
      const label = event.dataTransfer.getData('application/reactflow-label');

      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const defaultDataFn = nodeRegistry[type]?.defaultData;
      const initialData: any = defaultDataFn ? defaultDataFn(label) : { label, isOn: false };

      const newNode: any = {
        id: `${type}-${nodeId++}`,
        type,
        position,
        data: initialData,
      };

      setNodes((nds: any[]) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes, isSimulating]
  );

  const onNodeDragStop = useCallback((_event: any, draggedNode: Node) => {
    const updatedNodes = nodes.map(n => n.id === draggedNode.id ? draggedNode : n);
    const merged = mergeOverlappingNodesAndJunctions(updatedNodes, edges);
    const split = splitEdgesOnOverlappingNodes(merged.nodes, merged.edges);
    const simplifiedEdges = simplifyEdges(split.nodes, split.edges);
    
    setNodes(split.nodes);
    setEdges(simplifiedEdges);
  }, [nodes, edges, setNodes, setEdges]);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    if (probeMode && onEdgeProbe) {
      onEdgeProbe(edge.id, _);
    }
  }, [probeMode, onEdgeProbe]);

  // Read viewport scale and offsets to position the preview dot overlay correctly
  const { zoom, x: vpX, y: vpY } = getViewport();

  return (
    <div 
      className="flex-1 h-full relative" 
      ref={reactFlowWrapper} 
      style={probeMode ? { cursor: 'crosshair' } : undefined}
      onMouseMove={handleMouseMove}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStop={onNodeDragStop}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onEdgeClick={handleEdgeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={!isSimulating}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{ type: 'aura' }}
        snapToGrid={true}
        snapGrid={[4, 4]}
        fitView
      >
        {/* Drafting grid: 16px reads as guidance, the 8px default read as noise.
            Parts still snap at 4px (every node box is a multiple of 8, so pins
            land on the grid). */}
        <Background color="#cbd5e1" gap={16} size={1} />
        <Controls />
      </ReactFlow>

      {/* Connection point drop preview dot */}
      {previewJunction && (
        <>
          <div 
            className="absolute w-4 h-4 rounded-full bg-emerald-500/40 animate-ping pointer-events-none z-50 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: previewJunction.x * zoom + vpX,
              top: previewJunction.y * zoom + vpY,
            }}
          />
          <div 
            className="absolute w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white shadow-md pointer-events-none z-50 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: previewJunction.x * zoom + vpX,
              top: previewJunction.y * zoom + vpY,
            }}
          />
        </>
      )}
    </div>
  );
}
