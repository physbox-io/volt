/** Component datasheet info for the properties panel */

export interface DatasheetEntry {
  title: string;
  description: string;
  formula?: string;
  specs?: string[];
  truthTable?: string[][]; // header row + data rows
}

export const datasheets: Record<string, DatasheetEntry> = {
  resistor: {
    title: 'Resistor',
    description: 'Opposes current flow. Voltage drop is proportional to current.',
    formula: 'V = I × R  •  P = I²R = V²/R',
    specs: [
      'Typical tolerance: ±5% (gold band), ±1% (brown band)',
      'Standard power ratings: 1/8W, 1/4W, 1/2W, 1W',
      'SI suffixes: Ω, kΩ (10³), MΩ (10⁶)',
    ],
  },
  capacitor: {
    title: 'Capacitor',
    description: 'Stores energy in an electric field. Blocks DC, passes AC.',
    formula: 'I = C × dV/dt  •  Xc = 1/(2πfC)  •  τ = RC',
    specs: [
      'Charge: Q = CV',
      'Energy: E = ½CV²',
      'Time constant: τ = RC (63.2% charged)',
      'SI suffixes: F, µF (10⁻⁶), nF (10⁻⁹), pF (10⁻¹²)',
    ],
  },
  inductor: {
    title: 'Inductor',
    description: 'Stores energy in a magnetic field. Opposes changes in current.',
    formula: 'V = L × dI/dt  •  XL = 2πfL  •  τ = L/R',
    specs: [
      'Energy: E = ½LI²',
      'Time constant: τ = L/R',
      'Resonance with C: f₀ = 1/(2π√LC)',
      'SI suffixes: H, mH (10⁻³), µH (10⁻⁶)',
    ],
  },
  voltage: {
    title: 'DC Voltage Source',
    description: 'Provides a constant voltage between its terminals regardless of current drawn.',
    specs: [
      'Ideal source: zero internal resistance',
      'Real batteries: ~0.1–1Ω internal resistance',
      'Common values: 1.5V (AA), 3.3V, 5V, 9V, 12V',
    ],
  },
  acvoltage: {
    title: 'AC Voltage Source',
    description: 'Sinusoidal voltage source. Amplitude and frequency are configurable.',
    formula: 'V(t) = Vpeak × sin(2πft)',
    specs: [
      'Vrms = Vpeak / √2 ≈ Vpeak × 0.707',
      'US mains: 120Vrms @ 60Hz',
      'EU mains: 230Vrms @ 50Hz',
    ],
  },
  led: {
    title: 'Light Emitting Diode (LED)',
    description: 'Emits light when forward biased. Requires a current-limiting resistor.',
    formula: 'R = (Vsupply − Vf) / I_desired',
    specs: [
      'Red: Vf ≈ 1.8–2.0V, λ ≈ 620–630nm',
      'Green: Vf ≈ 2.0–2.2V, λ ≈ 520–530nm',
      'Blue/White: Vf ≈ 3.0–3.4V, λ ≈ 460–470nm',
      'Typical max current: 20mA',
    ],
  },
  diode: {
    title: 'Diode',
    description: 'Allows current flow in one direction only (anode → cathode).',
    formula: 'I = Is × (e^(V/nVt) − 1)  •  Vt ≈ 26mV @ 25°C',
    specs: [
      'Silicon: Vf ≈ 0.7V',
      'Germanium: Vf ≈ 0.3V',
      'Schottky: Vf ≈ 0.15–0.45V',
      '1N4148: fast signal diode, 100V PIV',
      '1N4001–1N4007: rectifier diodes, 50–1000V PIV',
    ],
  },
  zener: {
    title: 'Zener Diode',
    description: 'Operates in reverse breakdown to regulate voltage. Used as a voltage reference.',
    formula: 'Vout ≈ Vz (when I > Iz_min)',
    specs: [
      'Common Vz: 3.3V, 5.1V, 6.2V, 12V, 15V',
      'Minimum knee current: ~1–5mA',
      'Regulation: R_series = (Vin − Vz) / Iz',
    ],
  },
  npn: {
    title: 'NPN Bipolar Junction Transistor',
    description: 'Current-controlled amplifier. Base current controls collector-emitter current.',
    formula: 'Ic = β × Ib  •  Ve = Vb − 0.7V',
    specs: [
      'Pins: Collector (C), Base (B), Emitter (E)',
      'Active region: Vbe ≈ 0.7V, Vce > 0.2V',
      'Saturation: Vce(sat) ≈ 0.2V (fully on)',
      'Cutoff: Vbe < 0.5V (fully off)',
      '2N3904: β ≈ 100–300, Ic(max) = 200mA',
    ],
  },
  pnp: {
    title: 'PNP Bipolar Junction Transistor',
    description: 'Complement of NPN. Current flows from emitter to collector when base is pulled low.',
    formula: 'Ic = β × Ib  •  Ve = Vb + 0.7V',
    specs: [
      'Pins: Emitter (E), Base (B), Collector (C)',
      'Active: Veb ≈ 0.7V (base lower than emitter)',
      'Current flows E→C when B is pulled low',
      '2N3906: β ≈ 100–300, Ic(max) = 200mA',
    ],
  },
  nmos: {
    title: 'N-Channel MOSFET',
    description: 'Voltage-controlled switch. Gate voltage controls drain-source current. Very high input impedance.',
    formula: 'Id = Kp/2 × (Vgs − Vth)²  (saturation)',
    specs: [
      'Pins: Gate (G), Drain (D), Source (S)',
      'Enhancement mode: normally OFF, turns ON when Vgs > Vth',
      'Gate draws zero DC current (capacitive input)',
      'Typical Vth: 1–4V',
    ],
  },
  pmos: {
    title: 'P-Channel MOSFET',
    description: 'Complement of NMOS. Turns on when gate is pulled below source voltage.',
    formula: 'Id = Kp/2 × (Vsg − |Vth|)²  (saturation)',
    specs: [
      'Pins: Gate (G), Drain (D), Source (S)',
      'Enhancement mode: normally OFF, turns ON when Vgs < Vth (negative)',
      'Often used as high-side switch',
      'Typical Vth: −1 to −4V',
    ],
  },
  opamp: {
    title: 'Operational Amplifier',
    description: 'High-gain differential amplifier. Ideal op-amp: infinite gain, infinite input impedance, zero output impedance.',
    formula: 'Non-inv gain: 1 + Rf/Rg  •  Inv gain: −Rf/Rg',
    specs: [
      'Golden Rule 1: V+ = V− (virtual short)',
      'Golden Rule 2: No current into inputs',
      'Output clips at supply rails (Vcc/Vee)',
      'LM358: single supply, rail-to-ground output',
      'Unity-gain bandwidth: ~1MHz (typical)',
    ],
  },
  timer555: {
    title: 'NE555 Timer IC',
    description: 'Versatile timer IC. Can operate in astable (oscillator) or monostable (one-shot) mode.',
    formula: 'Astable: f = 1.44 / ((R1 + 2×R2) × C)\nDuty = (R1 + R2) / (R1 + 2×R2)',
    specs: [
      'Pins: 1-GND, 2-TRIG, 3-OUT, 4-RST, 5-CTRL, 6-THR, 7-DIS, 8-VCC',
      'Supply: 4.5V–16V',
      'Output current: up to 200mA',
      'Monostable: t = 1.1 × R × C',
    ],
  },
  signalgen: {
    title: 'Signal Generator',
    description: 'Generates configurable waveforms (sine, square) at a specified frequency and amplitude.',
    specs: [
      'Sine: V(t) = A × sin(2πft)',
      'Square: PULSE with configurable duty cycle',
      'Use with scope to visualize output',
    ],
  },
  scope: {
    title: 'Oscilloscope',
    description: 'Dual-channel voltage vs. time display. Supports FFT mode for frequency analysis.',
    specs: [
      'CH1 (yellow) and CH2 (cyan) inputs',
      'GND reference terminal',
      'V/div and Time/div auto-scale to signal',
      'FFT mode: shows frequency spectrum in dB',
    ],
  },
  multimeter: {
    title: 'Multimeter',
    description: 'Measures voltage between its positive and negative terminals.',
    specs: [
      'Very high input impedance (1GΩ)',
      'Displays final DC voltage value',
      'Connect + to node, − to ground reference',
    ],
  },
  speaker: {
    title: 'Speaker (8Ω)',
    description: 'Converts electrical signal to audio output. Plays the simulated waveform through your browser speakers.',
    specs: [
      'Impedance: 8Ω',
      'AC couple option removes DC offset',
      'Normalize option auto-adjusts volume',
      'Voltage scale sets full-volume level',
    ],
  },
  microphone: {
    title: 'Microphone',
    description: 'Captures real audio from your device microphone and injects it as a voltage source into the simulation.',
    specs: [
      'Records during simulation duration',
      'Amplification gain scales the output voltage',
      'Base level: ±50mV (electret mic)',
      'Output = raw × 0.05V × gain',
    ],
  },
  switch: {
    title: 'Switch (SPST)',
    description: 'Single-pole single-throw switch. Click to toggle between open and closed states.',
    specs: [
      'Open: ~infinite resistance (1TΩ)',
      'Closed: ~zero resistance (0.01Ω)',
      'Click the switch node to toggle',
    ],
  },
  mcu: {
    title: 'Microcontroller',
    description: 'Programmable microcontroller with digital and analog I/O. Write JavaScript code to control pins.',
    specs: [
      'Digital pins: D0–D3 (5V logic)',
      'Analog pins: A0–A1 (0–5V, 10-bit ADC)',
      'API: pinMode, digitalWrite, digitalRead',
      'API: analogWrite (8-bit), analogRead (10-bit)',
      'Serial.println() → Serial Monitor',
      'sleep(ms) for timing',
    ],
  },
  and: {
    title: 'AND Gate',
    description: 'Output is HIGH only when both inputs are HIGH.',
    truthTable: [
      ['A', 'B', 'Y'],
      ['0', '0', '0'],
      ['0', '1', '0'],
      ['1', '0', '0'],
      ['1', '1', '1'],
    ],
  },
  or: {
    title: 'OR Gate',
    description: 'Output is HIGH when at least one input is HIGH.',
    truthTable: [
      ['A', 'B', 'Y'],
      ['0', '0', '0'],
      ['0', '1', '1'],
      ['1', '0', '1'],
      ['1', '1', '1'],
    ],
  },
  not: {
    title: 'NOT Gate (Inverter)',
    description: 'Output is the logical complement of the input.',
    truthTable: [
      ['A', 'Y'],
      ['0', '1'],
      ['1', '0'],
    ],
  },
  nand: {
    title: 'NAND Gate',
    description: 'Output is LOW only when both inputs are HIGH. Universal gate.',
    truthTable: [
      ['A', 'B', 'Y'],
      ['0', '0', '1'],
      ['0', '1', '1'],
      ['1', '0', '1'],
      ['1', '1', '0'],
    ],
  },
  nor: {
    title: 'NOR Gate',
    description: 'Output is HIGH only when both inputs are LOW. Universal gate.',
    truthTable: [
      ['A', 'B', 'Y'],
      ['0', '0', '1'],
      ['0', '1', '0'],
      ['1', '0', '0'],
      ['1', '1', '0'],
    ],
  },
  xor: {
    title: 'XOR Gate',
    description: 'Output is HIGH when inputs are different.',
    truthTable: [
      ['A', 'B', 'Y'],
      ['0', '0', '0'],
      ['0', '1', '1'],
      ['1', '0', '1'],
      ['1', '1', '0'],
    ],
  },
  potentiometer: {
    title: 'Potentiometer',
    description: 'Variable resistor with a movable wiper. Acts as a voltage divider.',
    formula: 'Vwiper = Vin × (position / 100%)\nR_top = R × (1 − pos)  •  R_bot = R × pos',
    specs: [
      '3 terminals: in, out, wiper',
      'Wiper position: 0% (full to in) to 100% (full to out)',
      'Common values: 1kΩ, 10kΩ, 100kΩ',
      'Linear (B) or logarithmic (A) taper',
    ],
  },
  sevenseg: {
    title: '7-Segment Display',
    description: 'Displays a digit using 7 LED segments (a–g). Each segment lights when its input exceeds 2.5V.',
    specs: [
      'Segments: a(top), b(top-right), c(bot-right), d(bottom), e(bot-left), f(top-left), g(middle)',
      'Common cathode: segments are active HIGH',
      'Digit 0: a,b,c,d,e,f  •  Digit 1: b,c',
      'Digit 8: all segments  •  Digit 9: a,b,c,d,f,g',
    ],
  },
  currentsource: {
    title: 'Constant Current Source',
    description: 'Delivers a fixed current regardless of load voltage. Current flows from + to −.',
    formula: 'I = constant (set by parameter)',
    specs: [
      'Ideal: infinite output impedance',
      'Used in biasing, current mirrors, LED drivers',
      'Common values: 1mA, 10mA, 20mA',
      'Norton equivalent of a voltage source + series R',
    ],
  },
};
