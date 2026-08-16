
const { readFileSync } = require('fs');
const { join } = require('path');

// Mock fetch for the engine
globalThis.fetch = async (input) => {
    const url = input.toString();
    if (url.includes('spice.wasm')) {
        const wasmBuffer = readFileSync(join(process.cwd(), 'node_modules/eecircuit-engine/dist/spice.wasm'));
        return new Response(wasmBuffer, { headers: { 'Content-Type': 'application/wasm' } });
    }
    return fetch(input);
};

async function run() {
    console.log("Loading engine...");
    // Use the UMD bundle directly
    const { Simulation } = require('../node_modules/eecircuit-engine/dist/eecircuit-engine.umd.js');
    
    const sim = new Simulation();
    console.log("Starting engine...");
    await sim.start();
    
    const netlist = `
Circuit Simulation
V1 1 0 5
R1 1 0 1k
.save all
.tran 1m 10m
.end
    `;
    
    console.log("Setting netlist and running simulation...");
    sim.setNetList(netlist);
    const result = await sim.runSim();
    
    console.log("Simulation Result:", JSON.stringify(result, null, 2));
}

run().catch(console.error);
