import { basicBlink } from './utils/presets.js';
import { generateSpiceNetlist } from './utils/spice.js';

const netlist = generateSpiceNetlist(basicBlink.nodes, basicBlink.edges, 2);
console.log(netlist);
