
import { Simulation } from 'eecircuit-engine';
import { generateSpiceNetlist } from './utils/spice.js';

const basicBlink = {
  nodes: [
    { id: 'sg1', type: 'signalgen', data: { label: 'SIGNALGEN', waveform: 'square', frequency: 1, amplitude: 5 } },
    { id: 'r1', type: 'resistor', data: { label: '330Ω', resistance: 330 } },
    { id: 'led1', type: 'led', data: { label: 'LED', color: 'red', v_drop: 2.0, max_current: 20 } },
    { id: 'g1', type: 'ground', data: { label: 'GND' } },
    { id: 'g2', type: 'ground', data: { label: 'GND' } },
  ],
  edges: [
    { source: 'sg1', target: 'r1', sourceHandle: 'out', targetHandle: 'in' },
    { source: 'r1', target: 'led1', sourceHandle: 'out', targetHandle: 'anode' },
    { source: 'led1', target: 'g1', sourceHandle: 'cathode', targetHandle: 'in' },
    { source: 'sg1', target: 'g2', sourceHandle: 'gnd', targetHandle: 'in' },
  ]
};

async function runTest() {
  console.log("Generating netlist...");
  const { netlist, portToNet } = generateSpiceNetlist(basicBlink.nodes as any, basicBlink.edges as any);
  console.log("Netlist generated:");
  console.log(netlist);
  console.log("Port to Net map:", portToNet);

  try {
    console.log("Initializing simulation engine...");
    const engine = new Simulation();
    await engine.start();
    console.log("Engine initialized. Starting simulation...");
    
    // Set a timeout to avoid hanging forever
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Simulation timed out")), 10000)
    );
    
    engine.setNetList(netlist);
    const simPromise = engine.runSim();
    
    const result = await Promise.race([simPromise, timeoutPromise]) as any;
    console.log("Simulation completed successfully!");
    
    console.log(`Found ${result.numVariables} variables.`);
    result.variableNames.forEach((name: string) => {
      console.log(`Graph: ${name}`);
    });

    // Check LED specific nodes
    const anodeNet = portToNet['led1-anode'];
    const intNet = 'int_led_led1';
    
    const findGraph = (name: string) => {
        const search = name.toLowerCase();
        const idx = result.variableNames.findIndex((v: string) => v.toLowerCase() === search || v.toLowerCase() === `v(${search})`);
        if (idx !== -1 && result.data[idx]) {
            return {
                voltage_levels: result.data[idx].values
            };
        }
        return null;
    };

    const anodeGraph = findGraph(anodeNet);
    const intGraph = findGraph(intNet);

    if (anodeGraph && intGraph) {
      console.log("LED data found!");
      const max_vA = Math.max(...anodeGraph.voltage_levels);
      const max_vI = Math.max(...intGraph.voltage_levels);
      const max_current = (max_vA - max_vI) * 1000; // R=1
      console.log(`Max LED current: ${max_current.toFixed(2)} mA`);
    } else {
      console.log("LED data NOT found in results.");
      if (!anodeGraph) console.log(`Missing anode graph for net: ${anodeNet}`);
      if (!intGraph) console.log(`Missing internal graph for net: ${intNet}`);
    }

  } catch (error) {
    console.error("Test failed:", error);
  }
}

runTest();
