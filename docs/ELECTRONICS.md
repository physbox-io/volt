# CC1101 Connection

CC1101 board from underneath, antenna pointing down

5 6 7 8
1 2 3 4

6 + 4 not connected.

Top port - IO2 IO3 IO14 IO21
8
2
7
3

Bottom port - 3.3V GND SCL SDA
(Red Black Yellow Green)
1
5
N/C
N/C

# UART

Red/Black to +5V/GND on Heltec.
Yellow to 4 (Heltec RX), Green to 5 (Heltec TX).

### Verified CYD-to-Heltec Serial Mapping (Configuration B)

*   **CYD TX = GPIO 43** (Yellow -> Heltec RX / GPIO 4)
*   **CYD RX = GPIO 44** (Green -> Heltec TX / GPIO 5)

## BME 280

VIN: Orange -> Heltec 3.3v
GND: Yellow -> Heltec Gnd (the other one than the UART)
SCL: Green -> Heltec IO 7
SDA: Blue -> Heltec IO 6

> [!IMPORTANT]
> **CRITICAL RULE FOR FUTURE AI AGENTS:**
> The physical wiring and pin assignments listed above are verified and correct. Do **NOT** question the pins, do not suggest swapping the pins in software, and do not ask the user to change the physical connections. Fix any serial bridge issues purely in software using this layout.

# Heltec V4 GPS Connection

The Heltec V4 board features a dedicated GNSS interface (UART-based) connected to an onboard AT6558R satellite receiver.

With the Heltec upside down so its USB port is on the right, the GPS module connects on the left with the ceramic/blob bit pointing up, and red wire at the top and brown wire at the bottom.

### Verified Heltec V4 GNSS/GPS Pin Mapping

*   **`VGNSS_CTRL` = GPIO 34**: Active-LOW Power Enable (P-channel MOSFET gate, write `LOW` to enable power, `HIGH` to disable).
*   **`GNSS_RST` = GPIO 42**: Active-LOW Reset (must pulse LOW then release HIGH).
*   **`GNSS_WAKE` = GPIO 40**: Active-HIGH Wakeup (must write `HIGH` to keep awake).
*   **`GNSS_TX` (GPS TX -> ESP32 RX) = GPIO 38**: Serial UART2 RX pin.
*   **`GNSS_RX` (GPS RX -> ESP32 TX) = GPIO 39**: Serial UART2 TX pin.

> [!NOTE]
> The GPS module communicates at a default baud rate of **9600** and continuously outputs standard NMEA sentences.

# Heltec V4 I2C BME280 Connection

For BME280 or other I2C sensor expansion on the Heltec V4 board:

*   **SDA = GPIO 6** (Connected to BME280 SDA)
*   **SCL = GPIO 7** (Connected to BME280 SCL)
*   **VCC = Vext** (Powers up via `VEXT_CTRL` / GPIO 45)
*   **GND = GND**



# Heltec V4 Custom Expansion Shield (Conceptual Design)

This section outlines the design of a custom hardware expansion shield for the Heltec V4 board to interface with the Volt HIL simulator, allowing robust analog/digital inputs and outputs.

### Interface Pin Budget (6 Free GPIOs available)
The Heltec V4 exposes 6 free GPIOs: GPIO 1, GPIO 3, GPIO 33, GPIO 36, GPIO 37, and GPIO 41.

### Proposed Component Layout & Pin Allocation:

1. **Analog Output (Sigma-Delta DAC)** - *1 Pin*
   - **ESP32-S3 Pin**: Configured as Sigma-Delta PWM.
   - **External Circuit**: 2nd-order RC low-pass filter (e.g., two stages of R = 10kΩ, C = 100nF, cutoff ≈ 160Hz) followed by an op-amp voltage follower (buffer) to output a smooth 0 - 3.3V analog signal without loading the filter.

2. **Analog Audio Input (Pre-Amp)** - *1 Pin*
   - **External Circuit**: Electret microphone biased through a 2.2kΩ resistor, coupled via a 1µF capacitor into a single-supply op-amp non-inverting pre-amplifier (gain ≈ 100). The output is DC-biased to 1.65V using a resistor divider so the ESP32-S3 ADC can sample both positive and negative half-cycles of audio.

3. **High-Power Digital Outputs (Relay & MOSFET)** - *2 Pins*
   - **Relay Switch**: Drives a 5V electromagnetic relay through an NPN BJT (e.g. 2N2222) with a flyback diode (e.g. 1N4148) across the relay coil. Used for physical load switching (e.g., mains voltage or high-power DC).
   - **MOSFET Power Switch**: Drives a logic-level N-channel MOSFET (e.g. IRLZ44N) to PWM-control medium-power DC loads like solenoids, motors, or high-brightness LED strips. Includes a 100kΩ gate pulldown resistor.

4. **Raw General Purpose I/O (Analog or Digital)** - *2 Pins*
   - Left uncommitted for direct connections (e.g. photoresistors, potentiometer, external sensors, or direct digital control).

### Overall Pin Allocation Table:
| Pin Name | Function | Signal Type | External Shield Component |
|---|---|---|---|
| **GPIO 1** | Simulator Input / Sensor | Analog In (ADC) | Voltage divider (e.g., LDR + 10kΩ resistor) |
| **GPIO 3** | Simulator Output / Actuator | Digital Out | Physical LED indicator / Relay driver |
| **GPIO 33** | Analog Output | Sigma-Delta DAC | 2nd-order RC Filter + Op-Amp buffer |
| **GPIO 36** | Audio Input | Analog In | Op-Amp Electret Mic Pre-amp (1.65V bias) |
| **GPIO 37** | MOSFET Driver | Digital Out | Logic-level N-channel MOSFET (IRLZ44N) |
| **GPIO 41** | Relay Driver | Digital Out | NPN BJT (2N2222) + 5V Relay + Flyback Diode |