import type { PartEmitter } from '../part';

export const timer555: PartEmitter = {
  emit: (node, { net }) => {
    // Pins: 1:GND, 2:TRIG, 3:OUT, 4:RESET, 5:CTRL, 6:THR, 7:DIS, 8:VCC
    const pins = ['1', '2', '3', '4', '5', '6', '7', '8'].map(net);
    // Syntax: Xname GND TRIG OUT RST CTRL THR DIS VCC modelname
    return `X_${node.id} ${pins.join(' ')} NE555\n`;
  },
  // Basic NE555 macro model (rail-relative, with active-low RESET and smooth transitions)
  library: () => `
* Idealized NE555 Timer Macro Model
* Node order: GND TRIG OUT RST CTRL THR DIS VCC
.SUBCKT NE555 1 2 3 4 5 6 7 8
* Voltage divider
R1 8 5 5k
R2 5 61 5k
R3 61 1 5k

* Smooth SR Latch Integrator with active-low RESET (pin 4)
S_SET 8 state 61 2 SMOD_ON
S_RST state 1 6 5 SMOD_ON
S_RESET state 1 1 4 SMOD_RST
C1 state 1 100p
* Add parallel resistor to guarantee DC convergence
R4 state 1 10G

* Rail-relative smooth output buffer
B_OUT 3 1 V = V(8, 1) * 0.5 * (1 + tanh((V(state, 1) - 0.5 * V(8, 1)) / 0.1))

* Rail-relative discharge switch (ON when state < VCC/2)
B_DIS_CTRL dis_ctrl 1 V = 0.5 * V(8, 1) - V(state, 1)
S_DIS 7 1 dis_ctrl 1 SMOD_DIS

.MODEL SMOD_ON SW(VT=0 VH=0.05 RON=1k ROFF=10G)
.MODEL SMOD_RST SW(VT=-0.7 VH=0.05 RON=100 ROFF=10G)
.MODEL SMOD_DIS SW(VT=0 VH=0.05 RON=10 ROFF=10G)
.ENDS NE555
`,
};
