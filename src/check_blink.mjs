
import { Simulation } from 'eecircuit-engine';

async function run() {
    console.log("Starting Simulation test...");
    const sim = new Simulation();
    
    console.log("Initializing...");
    await sim.start();
    
    const netlist = `
Circuit Simulation
V1 1 0 5
R1 1 0 1k
.save all
.tran 1m 10m
.end
    `;
    
    console.log("Running sim...");
    sim.setNetList(netlist);
    const result = await sim.runSim();
    
    console.log("Result received!");
    console.log("Points:", result.numPoints);
}

run().then(() => console.log("Success")).catch(console.error);
