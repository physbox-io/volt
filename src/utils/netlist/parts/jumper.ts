import type { PartEmitter } from '../part';

// A wire jumper is board-only in the sense that the router never draws copper
// for it, but electrically it is a wire, so it does belong in the netlist.
export const jumper: PartEmitter = {
  emit: (node, { net }) => `R_${node.id} ${net('a')} ${net('b')} 0.001\n`,
};
