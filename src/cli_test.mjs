
import { Simulation } from 'eecircuit-engine';

async function main() {
  console.log("Creating Simulation instance...");
  const sim = new Simulation();
  
  console.log("Starting engine...");
  await sim.start();
  console.log("Engine started.");

  const netlist = `Blink Example
V1 N0 0 PULSE(0 5 0 1m 1m 500m 1)
R1 N0 N1 1k
C1 N1 0 100u
.save all
.tran 10m 2
.end
`;

  console.log("Setting netlist...");
  sim.setNetList(netlist);

  console.log("Running simulation...");
  try {
    const result = await sim.runSim();
    console.log("Simulation finished!");
    console.log("Points:", result.numPoints);
    console.log("Variables:", result.numVariables);
  } catch (err) {
    console.error("Simulation failed:", err);
  }
}

main().catch(console.error);
