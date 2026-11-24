import { useMCPBridge } from '../hooks/useMCPBridge';

type McpBridgeMountProps = Parameters<typeof useMCPBridge>[0];

/**
 * Null-rendering wrapper so `App.tsx` can lazy-load the MCP bridge (and its
 * static imports of `pcbExporter`, `clipper-lib`, and `machineMcp`) out of the
 * initial cold-start bundle.
 */
export default function McpBridgeMount(props: McpBridgeMountProps) {
  useMCPBridge(props);
  return null;
}
