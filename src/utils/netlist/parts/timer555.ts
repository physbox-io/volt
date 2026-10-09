import type { PartEmitter } from '../part';

export const timer555: PartEmitter = {
  emit: (node, { net }) => {
    // Pins: 1:GND, 2:TRIG, 3:OUT, 4:RESET, 5:CTRL, 6:THR, 7:DIS, 8:VCC
    const pins = ['1', '2', '3', '4', '5', '6', '7', '8'].map(net);
    // Syntax: Xname GND TRIG OUT RST CTRL THR DIS VCC modelname
    return `X_${node.id} ${pins.join(' ')} NE555\n`;
  },
  // Basic NE555 macro model (idealized for speed)
  library: () => `
* Idealized NE555 Timer Macro Model
* Node order: GND TRIG OUT RST CTRL THR DIS VCC
.SUBCKT NE555 1 2 3 4 5 6 7 8
* Voltage divider
R1 8 5 5k
R2 5 61 5k
R3 61 1 5k

* Smooth SR Latch Integrator
* Instead of G-source integrating to infinity, use standard switches to charge/discharge a capacitor
S_SET 8 state 61 2 SMOD_ON
S_RST state 1 6 5 SMOD_ON
C1 state 1 100p
* Add parallel resistor to guarantee DC convergence
R4 state 1 10G

* Output buffer
E_OUT 3 1 VOL={V(state)>2.5 ? V(8) : 0}

* Discharge
S_DIS 7 1 8 state SMOD_DIS

.MODEL SMOD_ON SW(VT=0 RON=1k ROFF=10G)
.MODEL SMOD_DIS SW(VT=2.5 RON=10 ROFF=10G)
.ENDS NE555
`,
};
