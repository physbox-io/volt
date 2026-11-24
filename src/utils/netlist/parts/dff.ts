import type { PartEmitter } from '../part';

export const dff: PartEmitter = {
  emit: (node, { net }) => {
    const d = net('d');
    const clk = net('clk');
    const q = net('q');
    const qbar = net('qbar');
    return `X_${node.id} ${d} ${clk} ${q} ${qbar} DFF\n`;
  },
  library: () => `
* Idealized Master-Slave D Flip-Flop (3.3V and 5V compatible, break-before-make)
* Node order: D CLK Q QBAR
.SUBCKT DFF D CLK Q QBAR
* High-impedance input buffer so D is not loaded by C_M
B_D_BUF d_buf 0 V = 5 / (1 + exp(-(V(D) - 1.5) / 0.05))

* Master Latch: closed when V(CLK) < 1.25V, open above 1.35V
S_M d_buf state_m 0 CLK SMOD_DFF_M
C_M state_m 0 100p
R_M state_m 0 1G

* Buffer master to slave to prevent charge sharing between C_M and C_S
B_state_m_buf state_m_buf 0 V = 5 / (1 + exp(-(V(state_m) - 2.5) / 0.05))

* Slave Latch: closed when V(CLK) > 1.75V, open below 1.65V (300mV deadband)
S_S state_m_buf state_s CLK 0 SMOD_DFF_S
C_S state_s 0 100p
R_S state_s 0 1G

* Smooth output drivers with finite 50 ohm output impedance
B_Q q_int 0 V = 5 / (1 + exp(-(V(state_s) - 2.5) / 0.05))
R_Q q_int Q 50
C_Q Q 0 10p
B_QBAR qbar_int 0 V = 5 / (1 + exp((V(state_s) - 2.5) / 0.05))
R_QBAR qbar_int QBAR 50
C_QBAR QBAR 0 10p

.MODEL SMOD_DFF_M SW(VT=-1.3 VH=0.05 RON=1k ROFF=1G)
.MODEL SMOD_DFF_S SW(VT=1.7 VH=0.05 RON=1k ROFF=1G)
.ENDS DFF
`,
};
