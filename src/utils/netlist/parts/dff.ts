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
* Idealized Master-Slave D Flip-Flop
* Node order: D CLK Q QBAR
.SUBCKT DFF D CLK Q QBAR
B_CLK_BAR clk_bar 0 V = 5 - V(CLK)

* Master Latch: closed when clk_bar > 2.5
S_M D state_m clk_bar 0 SMOD_DFF
C_M state_m 0 10n
R_M state_m 0 1G

* Buffer master to slave to prevent charge sharing between C_M and C_S
B_state_m_buf state_m_buf 0 V = V(state_m) > 2.5 ? 5 : 0

* Slave Latch: closed when CLK > 2.5
S_S state_m_buf state_s CLK 0 SMOD_DFF
C_S state_s 0 10n
R_S state_s 0 1G

* Output Drivers
B_Q Q 0 V = V(state_s) > 2.5 ? 5 : 0
B_QBAR QBAR 0 V = V(state_s) > 2.5 ? 0 : 5

.MODEL SMOD_DFF SW(VT=2.5 VH=0.2 RON=1k ROFF=1G)
.ENDS DFF
`,
};
