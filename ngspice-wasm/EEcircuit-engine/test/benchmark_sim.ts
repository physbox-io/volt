import { Simulation } from "../src/simulationLink.ts";
import { bsimTrans } from "../src/circuits.ts";

async function main() {
    const sim = new Simulation();
    await sim.start();

    // 1. Benchmark BSIM Trans
    console.log("Benchmarking bsimTrans (complex MOSFET circuit)...");
    sim.setNetList(bsimTrans);
    for (let i = 0; i < 5; i++) {
        const start = performance.now();
        const res = await sim.runSim();
        const end = performance.now();
        console.log(`Run ${i + 1}: ${res.numPoints} points, time = ${(end - start).toFixed(2)} ms`);
    }

    // 2. Benchmark Simple RC circuit
    console.log("\nBenchmarking simple RC circuit...");
    const simpleRC = `Simple RC
r1 1 2 1k
c1 2 0 1u
v1 1 0 pulse(0 5 1m 1u 1u 5m 10m)
.tran 10u 20m
.end
`;
    sim.setNetList(simpleRC);
    for (let i = 0; i < 5; i++) {
        const start = performance.now();
        const res = await sim.runSim();
        const end = performance.now();
        console.log(`Run ${i + 1}: ${res.numPoints} points, time = ${(end - start).toFixed(2)} ms`);
    }
}

main().catch(console.error);
