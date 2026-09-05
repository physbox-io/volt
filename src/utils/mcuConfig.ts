export type McuPinType = 'io' | 'digital' | 'analog' | 'power' | 'ground';
export type McuPinSide = 'left' | 'right' | 'top' | 'bottom';

export interface McuPinDef {
  id: string;              // e.g. 'D0', 'GPIO12', 'A0', 'PA1', '5V', 'GND'
  label: string;           // Display label in schematic & PCB silkscreen
  type: McuPinType;        // 'io' (universal), 'digital', 'analog', 'power', 'ground'
  side: McuPinSide;        // Which edge of the symbol/board the pin sits on ('left' | 'right' | 'top' | 'bottom')
  pinNumber?: number | string; // Physical pin number / pad index (1..N)
  voltage?: number;        // Default voltage for power pins (e.g. 5 or 3.3)
}

export type McuPackageStyle =
  | 'dip'             // Dual in-line package (left & right rows)
  | 'header_1x'       // Single inline pin header (1xN)
  | 'header_2x'       // Dual header module / breakout board (left & right rows with board courtyard)
  | 'header_matrix'   // Dual row compact pin header matrix (e.g. 2x4 Dupont header for CC1101, NRF24, etc.)
  | 'quad'            // 4-sided module / QFP / QFN style
  | 'custom';         // Custom geometry

export interface McuGeometryConfig {
  presetKey?: string;
  style: McuPackageStyle;
  pinCount: number;
  widthMm: number;        // Physical PCB width in mm
  heightMm: number;       // Physical PCB height in mm
  pitchMm: number;        // Pin pitch in mm (default 2.54mm or 1.27mm)
  rowSpacingMm?: number;  // Distance between pin rows for dual headers / DIP
  isSmd: boolean;         // Surface-mount pads vs Through-hole drilled pins
  drillDiaMm: number;     // Drill diameter for THT pins (default 1.0mm)
  padWidthMm: number;     // Copper pad width in mm (e.g. 1.8mm)
  padHeightMm: number;    // Copper pad height in mm (e.g. 1.8mm)
  pins: McuPinDef[];      // Pin definitions
}

/** Standard default 8-pin MCU configuration (backwards compatible with existing circuits) */
export const DEFAULT_MCU_CONFIG: McuGeometryConfig = {
  presetKey: 'dip8_standard',
  style: 'dip',
  pinCount: 8,
  widthMm: 10.0,
  heightMm: 12.0,
  pitchMm: 2.54,
  rowSpacingMm: 7.62,
  isSmd: false,
  drillDiaMm: 0.8,
  padWidthMm: 1.6,
  padHeightMm: 1.6,
  pins: [
    { id: 'D0', label: 'D0', type: 'io', side: 'left', pinNumber: 1 },
    { id: 'D1', label: 'D1', type: 'io', side: 'left', pinNumber: 2 },
    { id: 'D2', label: 'D2', type: 'io', side: 'left', pinNumber: 3 },
    { id: 'D3', label: 'D3', type: 'io', side: 'left', pinNumber: 4 },
    { id: 'GND', label: 'GND', type: 'ground', side: 'right', pinNumber: 5 },
    { id: '5V', label: '5V', type: 'power', side: 'right', pinNumber: 6, voltage: 5 },
    { id: 'A1', label: 'A1', type: 'io', side: 'right', pinNumber: 7 },
    { id: 'A0', label: 'A0', type: 'io', side: 'right', pinNumber: 8 },
  ],
};

export interface McuPreset {
  key: string;
  name: string;
  description: string;
  config: McuGeometryConfig;
}

export const MCU_PRESETS: McuPreset[] = [
  {
    key: 'dip8_standard',
    name: 'Standard DIP-8 MCU',
    description: 'Classic 8-pin Dual In-line Package with 4 Digital, 2 Analog, 5V, and GND',
    config: DEFAULT_MCU_CONFIG,
  },
  {
    key: 'dip14_generic',
    name: 'DIP-14 MCU (e.g. ATtiny84)',
    description: '14-pin DIP chip with 10 GPIOs, VCC, GND, RESET, and XTAL pins',
    config: {
      presetKey: 'dip14_generic',
      style: 'dip',
      pinCount: 14,
      widthMm: 10.0,
      heightMm: 19.0,
      pitchMm: 2.54,
      rowSpacingMm: 7.62,
      isSmd: false,
      drillDiaMm: 0.8,
      padWidthMm: 1.6,
      padHeightMm: 1.6,
      pins: [
        { id: 'VCC', label: 'VCC', type: 'power', side: 'left', pinNumber: 1, voltage: 5 },
        { id: 'PB0', label: 'PB0', type: 'io', side: 'left', pinNumber: 2 },
        { id: 'PB1', label: 'PB1', type: 'io', side: 'left', pinNumber: 3 },
        { id: 'PB3', label: 'PB3', type: 'io', side: 'left', pinNumber: 4 },
        { id: 'PB2', label: 'PB2', type: 'io', side: 'left', pinNumber: 5 },
        { id: 'PA7', label: 'PA7', type: 'io', side: 'left', pinNumber: 6 },
        { id: 'PA6', label: 'PA6', type: 'io', side: 'left', pinNumber: 7 },
        { id: 'GND', label: 'GND', type: 'ground', side: 'right', pinNumber: 8 },
        { id: 'PA0', label: 'PA0', type: 'io', side: 'right', pinNumber: 9 },
        { id: 'PA1', label: 'PA1', type: 'io', side: 'right', pinNumber: 10 },
        { id: 'PA2', label: 'PA2', type: 'io', side: 'right', pinNumber: 11 },
        { id: 'PA3', label: 'PA3', type: 'io', side: 'right', pinNumber: 12 },
        { id: 'PA4', label: 'PA4', type: 'io', side: 'right', pinNumber: 13 },
        { id: 'PA5', label: 'PA5', type: 'io', side: 'right', pinNumber: 14 },
      ],
    },
  },
  {
    key: 'dip28_atmega328',
    name: 'DIP-28 (ATmega328 / Uno Chip)',
    description: '28-pin DIP standard ATmega328P microcontroller chip',
    config: {
      presetKey: 'dip28_atmega328',
      style: 'dip',
      pinCount: 28,
      widthMm: 10.0,
      heightMm: 36.0,
      pitchMm: 2.54,
      rowSpacingMm: 7.62,
      isSmd: false,
      drillDiaMm: 0.8,
      padWidthMm: 1.6,
      padHeightMm: 1.6,
      pins: [
        { id: 'RESET', label: 'RST', type: 'io', side: 'left', pinNumber: 1 },
        { id: 'PD0', label: 'D0/RX', type: 'io', side: 'left', pinNumber: 2 },
        { id: 'PD1', label: 'D1/TX', type: 'io', side: 'left', pinNumber: 3 },
        { id: 'PD2', label: 'D2', type: 'io', side: 'left', pinNumber: 4 },
        { id: 'PD3', label: 'D3~', type: 'io', side: 'left', pinNumber: 5 },
        { id: 'PD4', label: 'D4', type: 'io', side: 'left', pinNumber: 6 },
        { id: 'VCC', label: 'VCC', type: 'power', side: 'left', pinNumber: 7, voltage: 5 },
        { id: 'GND', label: 'GND', type: 'ground', side: 'left', pinNumber: 8 },
        { id: 'PB6', label: 'XTAL1', type: 'io', side: 'left', pinNumber: 9 },
        { id: 'PB7', label: 'XTAL2', type: 'io', side: 'left', pinNumber: 10 },
        { id: 'PD5', label: 'D5~', type: 'io', side: 'left', pinNumber: 11 },
        { id: 'PD6', label: 'D6~', type: 'io', side: 'left', pinNumber: 12 },
        { id: 'PD7', label: 'D7', type: 'io', side: 'left', pinNumber: 13 },
        { id: 'PB0', label: 'D8', type: 'io', side: 'left', pinNumber: 14 },

        { id: 'GND2', label: 'GND', type: 'ground', side: 'right', pinNumber: 15 },
        { id: 'AREF', label: 'AREF', type: 'io', side: 'right', pinNumber: 16 },
        { id: 'AVCC', label: 'AVCC', type: 'power', side: 'right', pinNumber: 17, voltage: 5 },
        { id: 'PC5', label: 'A5/SCL', type: 'io', side: 'right', pinNumber: 18 },
        { id: 'PC4', label: 'A4/SDA', type: 'io', side: 'right', pinNumber: 19 },
        { id: 'PC3', label: 'A3', type: 'io', side: 'right', pinNumber: 20 },
        { id: 'PC2', label: 'A2', type: 'io', side: 'right', pinNumber: 21 },
        { id: 'PC1', label: 'A1', type: 'io', side: 'right', pinNumber: 22 },
        { id: 'PC0', label: 'A0', type: 'io', side: 'right', pinNumber: 23 },
        { id: 'PB5', label: 'D13/SCK', type: 'io', side: 'right', pinNumber: 24 },
        { id: 'PB4', label: 'D12/MISO', type: 'io', side: 'right', pinNumber: 25 },
        { id: 'PB3', label: 'D11/MOSI', type: 'io', side: 'right', pinNumber: 26 },
        { id: 'PB2', label: 'D10/SS', type: 'io', side: 'right', pinNumber: 27 },
        { id: 'PB1', label: 'D9~', type: 'io', side: 'right', pinNumber: 28 },
      ],
    },
  },
  {
    key: 'arduino_nano',
    name: 'Arduino Nano (30-Pin Board Module)',
    description: 'Standard 30-pin dual inline breakout board (15 pins per side)',
    config: {
      presetKey: 'arduino_nano',
      style: 'header_2x',
      pinCount: 30,
      widthMm: 18.0,
      heightMm: 45.0,
      pitchMm: 2.54,
      rowSpacingMm: 15.24,
      isSmd: false,
      drillDiaMm: 1.0,
      padWidthMm: 1.8,
      padHeightMm: 1.8,
      pins: [
        { id: 'TX', label: 'TX', type: 'io', side: 'left', pinNumber: 1 },
        { id: 'RX', label: 'RX', type: 'io', side: 'left', pinNumber: 2 },
        { id: 'RST1', label: 'RST', type: 'io', side: 'left', pinNumber: 3 },
        { id: 'GND1', label: 'GND', type: 'ground', side: 'left', pinNumber: 4 },
        { id: 'D2', label: 'D2', type: 'io', side: 'left', pinNumber: 5 },
        { id: 'D3', label: 'D3~', type: 'io', side: 'left', pinNumber: 6 },
        { id: 'D4', label: 'D4', type: 'io', side: 'left', pinNumber: 7 },
        { id: 'D5', label: 'D5~', type: 'io', side: 'left', pinNumber: 8 },
        { id: 'D6', label: 'D6~', type: 'io', side: 'left', pinNumber: 9 },
        { id: 'D7', label: 'D7', type: 'io', side: 'left', pinNumber: 10 },
        { id: 'D8', label: 'D8', type: 'io', side: 'left', pinNumber: 11 },
        { id: 'D9', label: 'D9~', type: 'io', side: 'left', pinNumber: 12 },
        { id: 'D10', label: 'D10~', type: 'io', side: 'left', pinNumber: 13 },
        { id: 'D11', label: 'D11~', type: 'io', side: 'left', pinNumber: 14 },
        { id: 'D12', label: 'D12', type: 'io', side: 'left', pinNumber: 15 },

        { id: 'D13', label: 'D13', type: 'io', side: 'right', pinNumber: 16 },
        { id: '3V3', label: '3V3', type: 'power', side: 'right', pinNumber: 17, voltage: 3.3 },
        { id: 'REF', label: 'REF', type: 'io', side: 'right', pinNumber: 18 },
        { id: 'A0', label: 'A0', type: 'io', side: 'right', pinNumber: 19 },
        { id: 'A1', label: 'A1', type: 'io', side: 'right', pinNumber: 20 },
        { id: 'A2', label: 'A2', type: 'io', side: 'right', pinNumber: 21 },
        { id: 'A3', label: 'A3', type: 'io', side: 'right', pinNumber: 22 },
        { id: 'A4', label: 'A4', type: 'io', side: 'right', pinNumber: 23 },
        { id: 'A5', label: 'A5', type: 'io', side: 'right', pinNumber: 24 },
        { id: 'A6', label: 'A6', type: 'io', side: 'right', pinNumber: 25 },
        { id: 'A7', label: 'A7', type: 'io', side: 'right', pinNumber: 26 },
        { id: '5V', label: '5V', type: 'power', side: 'right', pinNumber: 27, voltage: 5 },
        { id: 'RST2', label: 'RST', type: 'io', side: 'right', pinNumber: 28 },
        { id: 'GND2', label: 'GND', type: 'ground', side: 'right', pinNumber: 29 },
        { id: 'VIN', label: 'VIN', type: 'power', side: 'right', pinNumber: 30, voltage: 9 },
      ],
    },
  },
  {
    key: 'esp32_devkit',
    name: 'ESP32 DevKit (30-Pin Module)',
    description: 'ESP32 dual-row board module with 30 header pins',
    config: {
      presetKey: 'esp32_devkit',
      style: 'header_2x',
      pinCount: 30,
      widthMm: 28.0,
      heightMm: 52.0,
      pitchMm: 2.54,
      rowSpacingMm: 25.4,
      isSmd: false,
      drillDiaMm: 1.0,
      padWidthMm: 1.8,
      padHeightMm: 1.8,
      pins: [
        { id: 'EN', label: 'EN', type: 'io', side: 'left', pinNumber: 1 },
        { id: 'VP', label: 'GPIO36/VP', type: 'io', side: 'left', pinNumber: 2 },
        { id: 'VN', label: 'GPIO39/VN', type: 'io', side: 'left', pinNumber: 3 },
        { id: 'G34', label: 'GPIO34', type: 'io', side: 'left', pinNumber: 4 },
        { id: 'G35', label: 'GPIO35', type: 'io', side: 'left', pinNumber: 5 },
        { id: 'G32', label: 'GPIO32', type: 'io', side: 'left', pinNumber: 6 },
        { id: 'G33', label: 'GPIO33', type: 'io', side: 'left', pinNumber: 7 },
        { id: 'G25', label: 'GPIO25/DAC1', type: 'io', side: 'left', pinNumber: 8 },
        { id: 'G26', label: 'GPIO26/DAC2', type: 'io', side: 'left', pinNumber: 9 },
        { id: 'G27', label: 'GPIO27', type: 'io', side: 'left', pinNumber: 10 },
        { id: 'G14', label: 'GPIO14', type: 'io', side: 'left', pinNumber: 11 },
        { id: 'G12', label: 'GPIO12', type: 'io', side: 'left', pinNumber: 12 },
        { id: 'G13', label: 'GPIO13', type: 'io', side: 'left', pinNumber: 13 },
        { id: 'GND1', label: 'GND', type: 'ground', side: 'left', pinNumber: 14 },
        { id: 'VIN', label: 'VIN/5V', type: 'power', side: 'left', pinNumber: 15, voltage: 5 },

        { id: '3V3', label: '3V3', type: 'power', side: 'right', pinNumber: 16, voltage: 3.3 },
        { id: 'GND2', label: 'GND', type: 'ground', side: 'right', pinNumber: 17 },
        { id: 'G15', label: 'GPIO15', type: 'io', side: 'right', pinNumber: 18 },
        { id: 'G2', label: 'GPIO2', type: 'io', side: 'right', pinNumber: 19 },
        { id: 'G4', label: 'GPIO4', type: 'io', side: 'right', pinNumber: 20 },
        { id: 'G16', label: 'GPIO16/RX2', type: 'io', side: 'right', pinNumber: 21 },
        { id: 'G17', label: 'GPIO17/TX2', type: 'io', side: 'right', pinNumber: 22 },
        { id: 'G5', label: 'GPIO5', type: 'io', side: 'right', pinNumber: 23 },
        { id: 'G18', label: 'GPIO18/SCK', type: 'io', side: 'right', pinNumber: 24 },
        { id: 'G19', label: 'GPIO19/MISO', type: 'io', side: 'right', pinNumber: 25 },
        { id: 'G21', label: 'GPIO21/SDA', type: 'io', side: 'right', pinNumber: 26 },
        { id: 'RX0', label: 'GPIO3/RX0', type: 'io', side: 'right', pinNumber: 27 },
        { id: 'TX0', label: 'GPIO1/TX0', type: 'io', side: 'right', pinNumber: 28 },
        { id: 'G22', label: 'GPIO22/SCL', type: 'io', side: 'right', pinNumber: 29 },
        { id: 'G23', label: 'GPIO23/MOSI', type: 'io', side: 'right', pinNumber: 30 },
      ],
    },
  },
  {
    key: 'pico_rp2040',
    name: 'Raspberry Pi Pico (40-Pin Module)',
    description: 'RP2040 40-pin dual header / castellated module (20 pins per side)',
    config: {
      presetKey: 'pico_rp2040',
      style: 'header_2x',
      pinCount: 40,
      widthMm: 21.0,
      heightMm: 51.0,
      pitchMm: 2.54,
      rowSpacingMm: 17.78,
      isSmd: false,
      drillDiaMm: 1.0,
      padWidthMm: 1.8,
      padHeightMm: 1.8,
      pins: [
        { id: 'GP0', label: 'GP0', type: 'io', side: 'left', pinNumber: 1 },
        { id: 'GP1', label: 'GP1', type: 'io', side: 'left', pinNumber: 2 },
        { id: 'GND1', label: 'GND', type: 'ground', side: 'left', pinNumber: 3 },
        { id: 'GP2', label: 'GP2', type: 'io', side: 'left', pinNumber: 4 },
        { id: 'GP3', label: 'GP3', type: 'io', side: 'left', pinNumber: 5 },
        { id: 'GP4', label: 'GP4', type: 'io', side: 'left', pinNumber: 6 },
        { id: 'GP5', label: 'GP5', type: 'io', side: 'left', pinNumber: 7 },
        { id: 'GND2', label: 'GND', type: 'ground', side: 'left', pinNumber: 8 },
        { id: 'GP6', label: 'GP6', type: 'io', side: 'left', pinNumber: 9 },
        { id: 'GP7', label: 'GP7', type: 'io', side: 'left', pinNumber: 10 },
        { id: 'GP8', label: 'GP8', type: 'io', side: 'left', pinNumber: 11 },
        { id: 'GP9', label: 'GP9', type: 'io', side: 'left', pinNumber: 12 },
        { id: 'GND3', label: 'GND', type: 'ground', side: 'left', pinNumber: 13 },
        { id: 'GP10', label: 'GP10', type: 'io', side: 'left', pinNumber: 14 },
        { id: 'GP11', label: 'GP11', type: 'io', side: 'left', pinNumber: 15 },
        { id: 'GP12', label: 'GP12', type: 'io', side: 'left', pinNumber: 16 },
        { id: 'GP13', label: 'GP13', type: 'io', side: 'left', pinNumber: 17 },
        { id: 'GND4', label: 'GND', type: 'ground', side: 'left', pinNumber: 18 },
        { id: 'GP14', label: 'GP14', type: 'io', side: 'left', pinNumber: 19 },
        { id: 'GP15', label: 'GP15', type: 'io', side: 'left', pinNumber: 20 },

        { id: 'GP16', label: 'GP16', type: 'io', side: 'right', pinNumber: 21 },
        { id: 'GP17', label: 'GP17', type: 'io', side: 'right', pinNumber: 22 },
        { id: 'GND5', label: 'GND', type: 'ground', side: 'right', pinNumber: 23 },
        { id: 'GP18', label: 'GP18', type: 'io', side: 'right', pinNumber: 24 },
        { id: 'GP19', label: 'GP19', type: 'io', side: 'right', pinNumber: 25 },
        { id: 'GP20', label: 'GP20', type: 'io', side: 'right', pinNumber: 26 },
        { id: 'GP21', label: 'GP21', type: 'io', side: 'right', pinNumber: 27 },
        { id: 'GND6', label: 'GND', type: 'ground', side: 'right', pinNumber: 28 },
        { id: 'GP22', label: 'GP22', type: 'io', side: 'right', pinNumber: 29 },
        { id: 'RUN', label: 'RUN', type: 'io', side: 'right', pinNumber: 30 },
        { id: 'GP26', label: 'GP26/A0', type: 'io', side: 'right', pinNumber: 31 },
        { id: 'GP27', label: 'GP27/A1', type: 'io', side: 'right', pinNumber: 32 },
        { id: 'GND_ADC', label: 'GND', type: 'ground', side: 'right', pinNumber: 33 },
        { id: 'GP28', label: 'GP28/A2', type: 'io', side: 'right', pinNumber: 34 },
        { id: 'ADC_VREF', label: 'VREF', type: 'io', side: 'right', pinNumber: 35 },
        { id: '3V3_OUT', label: '3V3', type: 'power', side: 'right', pinNumber: 36, voltage: 3.3 },
        { id: '3V3_EN', label: '3V3_EN', type: 'io', side: 'right', pinNumber: 37 },
        { id: 'GND7', label: 'GND', type: 'ground', side: 'right', pinNumber: 38 },
        { id: 'VSYS', label: 'VSYS', type: 'power', side: 'right', pinNumber: 39, voltage: 5 },
        { id: 'VBUS', label: 'VBUS', type: 'power', side: 'right', pinNumber: 40, voltage: 5 },
      ],
    },
  },
  {
    key: 'quad_module_16',
    name: '4-Sided SMD Module / QFP (16-Pin)',
    description: 'Square 4-sided module with 4 pins per side (left, right, top, bottom)',
    config: {
      presetKey: 'quad_module_16',
      style: 'quad',
      pinCount: 16,
      widthMm: 15.0,
      heightMm: 15.0,
      pitchMm: 2.0,
      isSmd: true,
      drillDiaMm: 0,
      padWidthMm: 1.5,
      padHeightMm: 0.8,
      pins: [
        // Left side (1..4)
        { id: 'P1', label: 'P1', type: 'io', side: 'left', pinNumber: 1 },
        { id: 'P2', label: 'P2', type: 'io', side: 'left', pinNumber: 2 },
        { id: 'P3', label: 'P3', type: 'io', side: 'left', pinNumber: 3 },
        { id: 'P4', label: 'P4', type: 'io', side: 'left', pinNumber: 4 },
        // Bottom side (5..8)
        { id: 'P5', label: 'P5', type: 'io', side: 'bottom', pinNumber: 5 },
        { id: 'P6', label: 'P6', type: 'io', side: 'bottom', pinNumber: 6 },
        { id: 'GND', label: 'GND', type: 'ground', side: 'bottom', pinNumber: 7 },
        { id: 'P8', label: 'P8', type: 'io', side: 'bottom', pinNumber: 8 },
        // Right side (9..12)
        { id: 'P9', label: 'P9', type: 'io', side: 'right', pinNumber: 9 },
        { id: 'P10', label: 'P10', type: 'io', side: 'right', pinNumber: 10 },
        { id: 'P11', label: 'P11', type: 'io', side: 'right', pinNumber: 11 },
        { id: 'P12', label: 'P12', type: 'io', side: 'right', pinNumber: 12 },
        // Top side (13..16)
        { id: '3V3', label: '3V3', type: 'power', side: 'top', pinNumber: 13, voltage: 3.3 },
        { id: 'P14', label: 'P14', type: 'io', side: 'top', pinNumber: 14 },
        { id: 'P15', label: 'P15', type: 'io', side: 'top', pinNumber: 15 },
        { id: 'P16', label: 'P16', type: 'io', side: 'top', pinNumber: 16 },
      ],
    },
  },
  {
    key: 'header_1x6',
    name: '1x6 Pin Header Module',
    description: 'Single-row 6-pin breakout header',
    config: {
      presetKey: 'header_1x6',
      style: 'header_1x',
      pinCount: 6,
      widthMm: 15.24,
      heightMm: 5.0,
      pitchMm: 2.54,
      isSmd: false,
      drillDiaMm: 1.0,
      padWidthMm: 1.8,
      padHeightMm: 1.8,
      pins: [
        { id: 'VCC', label: 'VCC', type: 'power', side: 'left', pinNumber: 1, voltage: 5 },
        { id: 'GND', label: 'GND', type: 'ground', side: 'left', pinNumber: 2 },
        { id: 'TX', label: 'TX', type: 'io', side: 'left', pinNumber: 3 },
        { id: 'RX', label: 'RX', type: 'io', side: 'left', pinNumber: 4 },
        { id: 'SDA', label: 'SDA', type: 'io', side: 'left', pinNumber: 5 },
        { id: 'SCL', label: 'SCL', type: 'io', side: 'left', pinNumber: 6 },
      ],
    },
  },
  {
    key: 'cc1101',
    name: 'CC1101 RF Transceiver (2x4 Dupont)',
    description: 'CC1101 Sub-1GHz RF transceiver module with 8-pin (2x4) dual row Dupont header (VCC, GND, MOSI, SCLK, MISO, GDO2, GDO0, CSN)',
    config: {
      presetKey: 'cc1101',
      style: 'header_matrix',
      pinCount: 8,
      widthMm: 19.0,
      heightMm: 17.0,
      pitchMm: 2.54,
      rowSpacingMm: 2.54,
      isSmd: false,
      drillDiaMm: 0.9,
      padWidthMm: 1.6,
      padHeightMm: 1.6,
      pins: [
        { id: 'VCC', label: 'VCC', type: 'power', side: 'left', pinNumber: 1, voltage: 3.3 },
        { id: 'GND', label: 'GND', type: 'ground', side: 'left', pinNumber: 2 },
        { id: 'MOSI', label: 'SI', type: 'io', side: 'left', pinNumber: 3 },
        { id: 'SCLK', label: 'SCLK', type: 'io', side: 'left', pinNumber: 4 },
        { id: 'MISO', label: 'SO', type: 'io', side: 'right', pinNumber: 5 },
        { id: 'GDO2', label: 'GDO2', type: 'io', side: 'right', pinNumber: 6 },
        { id: 'GDO0', label: 'GDO0', type: 'io', side: 'right', pinNumber: 7 },
        { id: 'CSN', label: 'CSN', type: 'io', side: 'right', pinNumber: 8 },
      ],
    },
  },
  {
    key: 'heltec_v4',
    name: 'Heltec WiFi LoRa 32 V4 (Dual Header Board)',
    description: 'Heltec WiFi LoRa 32 V4 dual header board module (36 pins / 18 pins per side, 25.5x47.88mm)',
    config: {
      presetKey: 'heltec_v4',
      style: 'header_2x',
      pinCount: 36,
      widthMm: 25.5,
      heightMm: 47.88,
      pitchMm: 2.54,
      rowSpacingMm: 22.86,
      isSmd: false,
      drillDiaMm: 1.0,
      padWidthMm: 1.8,
      padHeightMm: 1.8,
      pins: [
        { id: '3V3', label: '3V3', type: 'power', side: 'left', pinNumber: 1, voltage: 3.3 },
        { id: 'GND1', label: 'GND', type: 'ground', side: 'left', pinNumber: 2 },
        { id: 'GPIO_1', label: 'GPIO_1/A0', type: 'io', side: 'left', pinNumber: 3 },
        { id: 'GPIO_2', label: 'GPIO_2', type: 'io', side: 'left', pinNumber: 4 },
        { id: 'GPIO_3', label: 'GPIO_3', type: 'io', side: 'left', pinNumber: 5 },
        { id: 'GPIO_4', label: 'GPIO_4', type: 'io', side: 'left', pinNumber: 6 },
        { id: 'GPIO_5', label: 'GPIO_5', type: 'io', side: 'left', pinNumber: 7 },
        { id: 'GPIO_6', label: 'GPIO_6', type: 'io', side: 'left', pinNumber: 8 },
        { id: 'GPIO_7', label: 'GPIO_7', type: 'io', side: 'left', pinNumber: 9 },
        { id: 'GPIO_8', label: 'GPIO_8', type: 'io', side: 'left', pinNumber: 10 },
        { id: 'GPIO_9', label: 'GPIO_9', type: 'io', side: 'left', pinNumber: 11 },
        { id: 'GPIO_10', label: 'GPIO_10', type: 'io', side: 'left', pinNumber: 12 },
        { id: 'GPIO_11', label: 'GPIO_11', type: 'io', side: 'left', pinNumber: 13 },
        { id: 'GPIO_12', label: 'GPIO_12', type: 'io', side: 'left', pinNumber: 14 },
        { id: 'GPIO_13', label: 'GPIO_13', type: 'io', side: 'left', pinNumber: 15 },
        { id: 'GPIO_14', label: 'GPIO_14', type: 'io', side: 'left', pinNumber: 16 },
        { id: 'GPIO_17', label: 'GPIO_17', type: 'io', side: 'left', pinNumber: 17 },
        { id: 'GPIO_18', label: 'GPIO_18', type: 'io', side: 'left', pinNumber: 18 },

        { id: 'VIN', label: '5V/VIN', type: 'power', side: 'right', pinNumber: 19, voltage: 5.0 },
        { id: 'GND2', label: 'GND', type: 'ground', side: 'right', pinNumber: 20 },
        { id: 'GPIO_21', label: 'GPIO_21', type: 'io', side: 'right', pinNumber: 21 },
        { id: 'GPIO_26', label: 'GPIO_26', type: 'io', side: 'right', pinNumber: 22 },
        { id: 'GPIO_33', label: 'GPIO_33', type: 'io', side: 'right', pinNumber: 23 },
        { id: 'GPIO_34', label: 'GPIO_34', type: 'io', side: 'right', pinNumber: 24 },
        { id: 'GPIO_35', label: 'GPIO_35', type: 'io', side: 'right', pinNumber: 25 },
        { id: 'GPIO_36', label: 'GPIO_36', type: 'io', side: 'right', pinNumber: 26 },
        { id: 'GPIO_37', label: 'GPIO_37', type: 'io', side: 'right', pinNumber: 27 },
        { id: 'GPIO_38', label: 'GPIO_38', type: 'io', side: 'right', pinNumber: 28 },
        { id: 'GPIO_39', label: 'GPIO_39', type: 'io', side: 'right', pinNumber: 29 },
        { id: 'GPIO_40', label: 'GPIO_40', type: 'io', side: 'right', pinNumber: 30 },
        { id: 'GPIO_41', label: 'GPIO_41', type: 'io', side: 'right', pinNumber: 31 },
        { id: 'GPIO_42', label: 'GPIO_42', type: 'io', side: 'right', pinNumber: 32 },
        { id: 'GPIO_45', label: 'GPIO_45', type: 'io', side: 'right', pinNumber: 33 },
        { id: 'GPIO_46', label: 'GPIO_46', type: 'io', side: 'right', pinNumber: 34 },
        { id: 'GPIO_47', label: 'GPIO_47', type: 'io', side: 'right', pinNumber: 35 },
        { id: 'RST', label: 'RST', type: 'io', side: 'right', pinNumber: 36 },
      ],
    },
  },
];

/**
 * Returns the effective McuGeometryConfig for a node, resolving any defaults.
 */
export function getEffectiveMcuConfig(data?: any): McuGeometryConfig {
  if (!data || !data.mcuConfig) {
    return DEFAULT_MCU_CONFIG;
  }
  const cfg = data.mcuConfig as McuGeometryConfig;
  return {
    presetKey: cfg.presetKey || 'custom',
    style: cfg.style || 'dip',
    pinCount: cfg.pins ? cfg.pins.length : (cfg.pinCount || DEFAULT_MCU_CONFIG.pinCount),
    widthMm: cfg.widthMm || DEFAULT_MCU_CONFIG.widthMm,
    heightMm: cfg.heightMm || DEFAULT_MCU_CONFIG.heightMm,
    pitchMm: cfg.pitchMm || 2.54,
    rowSpacingMm: cfg.rowSpacingMm,
    isSmd: !!cfg.isSmd,
    drillDiaMm: cfg.drillDiaMm ?? (cfg.isSmd ? 0 : 0.8),
    padWidthMm: cfg.padWidthMm || (cfg.isSmd ? 1.5 : 1.8),
    padHeightMm: cfg.padHeightMm || (cfg.isSmd ? 0.8 : 1.8),
    pins: cfg.pins && cfg.pins.length > 0 ? cfg.pins : DEFAULT_MCU_CONFIG.pins,
  };
}

/**
 * Generates an N-pin custom MCU config given counts and style.
 */
export function createCustomMcuConfig(
  pinCount: number,
  style: McuPackageStyle = 'dip',
  opts?: Partial<McuGeometryConfig>
): McuGeometryConfig {
  const count = Math.max(1, pinCount);
  const pitchMm = opts?.pitchMm || 2.54;
  const isSmd = !!opts?.isSmd;
  const pins: McuPinDef[] = [];

  let widthMm = opts?.widthMm || 15.0;
  let heightMm = opts?.heightMm || 20.0;

  if (style === 'header_matrix') {
    const cols = Math.ceil(count / 2);
    widthMm = Math.max(10, (cols + 1) * pitchMm);
    heightMm = Math.max(10, 3 * pitchMm);
    const rowSpacingMm = opts?.rowSpacingMm || 2.54;

    for (let i = 0; i < cols; i++) {
      pins.push({
        id: `P${i + 1}`,
        label: i === 0 ? 'VCC' : `IO${i}`,
        type: i === 0 ? 'power' : 'io',
        side: 'left',
        pinNumber: i + 1,
        voltage: i === 0 ? 3.3 : undefined,
      });
    }
    for (let i = 0; i < cols; i++) {
      const idx = cols + i;
      if (idx < count) {
        pins.push({
          id: `P${idx + 1}`,
          label: i === 0 ? 'GND' : `IO${cols + i - 1}`,
          type: i === 0 ? 'ground' : 'io',
          side: 'right',
          pinNumber: idx + 1,
        });
      }
    }

    return {
      presetKey: 'custom',
      style,
      pinCount: pins.length,
      widthMm: opts?.widthMm || widthMm,
      heightMm: opts?.heightMm || heightMm,
      pitchMm,
      rowSpacingMm,
      isSmd,
      drillDiaMm: opts?.drillDiaMm ?? (isSmd ? 0 : 1.0),
      padWidthMm: opts?.padWidthMm || 1.8,
      padHeightMm: opts?.padHeightMm || 1.8,
      pins,
    };
  }

  if (style === 'dip' || style === 'header_2x') {
    const pinsPerSide = Math.ceil(count / 2);
    heightMm = Math.max(15, (pinsPerSide + 1) * pitchMm);
    widthMm = style === 'dip' ? 10.0 : (opts?.widthMm || 20.0);

    for (let i = 0; i < pinsPerSide; i++) {
      pins.push({
        id: `P${i + 1}`,
        label: i === 0 ? 'VCC' : `IO${i}`,
        type: i === 0 ? 'power' : 'io',
        side: 'left',
        pinNumber: i + 1,
        voltage: i === 0 ? 5 : undefined,
      });
    }
    for (let i = 0; i < pinsPerSide; i++) {
      const idx = pinsPerSide + i;
      if (idx < count) {
        pins.push({
          id: `P${idx + 1}`,
          label: i === 0 ? 'GND' : `IO${pinsPerSide + i - 1}`,
          type: i === 0 ? 'ground' : 'io',
          side: 'right',
          pinNumber: idx + 1,
        });
      }
    }
  } else if (style === 'header_1x') {
    heightMm = Math.max(10, (count + 1) * pitchMm);
    widthMm = 5.0;
    for (let i = 0; i < count; i++) {
      pins.push({
        id: `P${i + 1}`,
        label: i === 0 ? 'VCC' : i === 1 ? 'GND' : `IO${i - 1}`,
        type: i === 0 ? 'power' : i === 1 ? 'ground' : 'io',
        side: 'left',
        pinNumber: i + 1,
        voltage: i === 0 ? 5 : undefined,
      });
    }
  } else if (style === 'quad') {
    const perSide = Math.ceil(count / 4);
    const sideLen = Math.max(15, (perSide + 2) * pitchMm);
    widthMm = sideLen;
    heightMm = sideLen;

    let pNum = 1;
    const sides: McuPinSide[] = ['left', 'bottom', 'right', 'top'];
    for (const side of sides) {
      for (let i = 0; i < perSide; i++) {
        if (pNum <= count) {
          pins.push({
            id: `P${pNum}`,
            label: pNum === 1 ? 'VCC' : pNum === Math.floor(count / 2) ? 'GND' : `IO${pNum}`,
            type: pNum === 1 ? 'power' : pNum === Math.floor(count / 2) ? 'ground' : 'io',
            side,
            pinNumber: pNum,
            voltage: pNum === 1 ? 3.3 : undefined,
          });
          pNum++;
        }
      }
    }
  }

  return {
    presetKey: 'custom',
    style,
    pinCount: pins.length,
    widthMm: opts?.widthMm || widthMm,
    heightMm: opts?.heightMm || heightMm,
    pitchMm,
    rowSpacingMm: opts?.rowSpacingMm || (style === 'dip' ? 7.62 : widthMm - 2.54),
    isSmd,
    drillDiaMm: opts?.drillDiaMm ?? (isSmd ? 0 : 0.8),
    padWidthMm: opts?.padWidthMm || (isSmd ? 1.5 : 1.8),
    padHeightMm: opts?.padHeightMm || (isSmd ? 0.8 : 1.8),
    pins,
  };
}
