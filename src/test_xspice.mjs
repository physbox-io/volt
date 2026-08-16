import { Simulation } from 'eecircuit-engine';

async function main() {
  const sim = new Simulation();
  await sim.start();

const netlist = `Circuit Simulation
V_sg1 N1 0 PULSE(-5 5 0 1m 1m 0.5 1)
R_r1 N1 N2 330
R_ammeter_led1 N2 int_led_led1 1
D_led1 int_led_led1 0 LED_MODEL_led1
.model LED_MODEL_led1 D(IS=1e-22 RS=5 N=1.6666666666666667)
.save all
.tran 1m 2s
.end
`;

  sim.setNetList(netlist);
  const result = await sim.runSim();

  if (result && result.numPoints > 0) {
    console.log("Variables:", result.variables);
    const n1Idx = result.variables.indexOf('v(n1)');
    const n2Idx = result.variables.indexOf('v(n2)');
    const timeIdx = result.variables.indexOf('time');

    if (n1Idx !== -1 && timeIdx !== -1) {
      console.log("Basic blink test succeeded. Points:", result.numPoints);
      const times = result.data[timeIdx];
      const n1s = result.data[n1Idx];
      
      console.log("At t=0s:", n1s[times.findIndex(t => t >= 0)]);
      console.log("At t=0.25s:", n1s[times.findIndex(t => t >= 0.25)]);
      console.log("At t=0.75s:", n1s[times.findIndex(t => t >= 0.75)]);
      console.log("At t=1.25s:", n1s[times.findIndex(t => t >= 1.25)]);
      console.log("At t=1.75s:", n1s[times.findIndex(t => t >= 1.75)]);
    } else {
      console.log("No out variable found. Variables:", result.variables);
    }
  } else {
    console.log("Simulation failed or no points returned.");
  }
}

main().catch(console.error);
