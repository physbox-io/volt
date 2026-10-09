import type { PartEmitter } from './part';
import { jumper } from './parts/jumper';
import { resistor } from './parts/resistor';
import { capacitor } from './parts/capacitor';
import { inductor } from './parts/inductor';
import { voltage } from './parts/voltage';
import { acvoltage } from './parts/acvoltage';
import { led } from './parts/led';
import { diode } from './parts/diode';
import { zener } from './parts/zener';
import { switchPart } from './parts/switch';
import { opamp } from './parts/opamp';
import { timer555 } from './parts/timer555';
import { multimeter } from './parts/multimeter';
import { signalgen } from './parts/signalgen';
import { scope } from './parts/scope';
import { potentiometer } from './parts/potentiometer';
import { sevenseg } from './parts/sevenseg';
import { currentsource } from './parts/currentsource';
import { speaker } from './parts/speaker';
import { microphone } from './parts/microphone';
import { npn, pnp } from './parts/bjt';
import { nmos, pmos } from './parts/mosfet';
import { and, or, nand, nor, xor, not } from './parts/logicGates';
import { mcu } from './parts/mcu';
import { transformer } from './parts/transformer';
import { dff } from './parts/dff';
import { ldr } from './parts/ldr';
import { heltec } from './parts/heltec';
import { dcmotor } from './parts/dcmotor';
import { stepper } from './parts/stepper';
import { stepdriver } from './parts/stepdriver';
import { hbridge } from './parts/hbridge';
import { fuse } from './parts/fuse';

/**
 * How each part type reaches SPICE, by `node.type`. A new part is a file in
 * `parts/` and a line here.
 *
 * The order matters only for `library` entries: their subcircuits are written
 * in this order.
 */
export const partEmitters: Record<string, PartEmitter> = {
  jumper,
  resistor,
  capacitor,
  inductor,
  voltage,
  acvoltage,
  led,
  diode,
  zener,
  switch: switchPart,
  opamp,
  timer555,
  multimeter,
  signalgen,
  scope,
  potentiometer,
  sevenseg,
  currentsource,
  speaker,
  microphone,
  npn,
  pnp,
  nmos,
  pmos,
  and,
  or,
  nand,
  nor,
  xor,
  not,
  mcu,
  transformer,
  dff,
  ldr,
  heltec_v4: heltec,
  dcmotor,
  stepper,
  stepdriver,
  hbridge,
  fuse,
};
