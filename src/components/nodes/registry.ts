import type { ComponentType } from 'react';
import type { Node } from '@xyflow/react';
import type { AnyNodeData } from '../../types/nodes';

export interface NodePropertiesProps {
  /*
   * Every field of every part, rather than the one kind this panel is for.
   * `nodeRegistry` below is a `Record<string, NodeMeta>` dispatched on
   * `node.type` at run time, so there is no point at which the compiler knows
   * which entry the panel was handed — a per-kind type here would have to be
   * cast back out at the registry, which is the same hole with more ceremony.
   */
  node: Node<AnyNodeData>;
  updateData: (key: string, value: unknown) => void;
  isSimulating: boolean;
  simLength: number;
  webcam: {
    stream: MediaStream | null;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    isRecordingWebcam: boolean;
    startRecordingWebcam: () => void;
  };
}

export interface NodeMeta {
  Properties?: ComponentType<NodePropertiesProps>;
  /** Extra `data` fields to seed on the node when it's dropped onto the canvas, beyond the sidebar's base label/data. */
  defaultData?: (label?: string) => AnyNodeData;
}

import { VoltageProperties } from './VoltageNode';
import { ACVoltageProperties } from './ACVoltageNode';
import { ResistorProperties } from './ResistorNode';
import { CapacitorProperties } from './CapacitorNode';
import { InductorProperties } from './InductorNode';
import { SwitchProperties } from './SwitchNode';
import { LEDProperties } from './LEDNode';
import { SignalGeneratorProperties } from './SignalGeneratorNode';
import { MicrocontrollerProperties } from './MicrocontrollerNode';
import { BJTProperties } from './NpnNode';
import { MosfetProperties } from './NmosNode';
import { DiodeProperties } from './DiodeNode';
import { ZenerDiodeProperties } from './ZenerDiodeNode';
import { MicrophoneProperties } from './MicrophoneNode';
import { SpeakerProperties } from './SpeakerNode';
import { ScopeProperties } from './ScopeNode';
import { MultimeterProperties } from './MultimeterNode';
import { PotentiometerProperties } from './PotentiometerNode';
import { TransformerProperties } from './TransformerNode';
import { DFlipFlopProperties } from './DFlipFlopNode';
import { LDRProperties } from './LDRNode';
import { SevenSegmentProperties } from './SevenSegmentNode';
import { CurrentSourceProperties } from './CurrentSourceNode';
import { HeltecV4Properties } from './HeltecV4Node';
import { PinHeaderProperties } from './PinHeaderNode';
import { ViaProperties } from './ViaNode';
import { MountingHoleProperties } from './MountingHoleNode';
import { JumperProperties } from './JumperNode';
import { CutoutProperties } from './CutoutNode';
// The seed data a part is dropped with lives in `partDefaults.ts` rather than
// in each part's component file: a file that exports both a component and a
// plain function loses React Fast Refresh, and a full reload on this canvas
// throws away the running simulation and the circuit view being edited.
import {
  transformerDefaultData,
  dffDefaultData,
  ldrDefaultData,
  heltecV4DefaultData,
  pinHeaderDefaultData,
  viaDefaultData,
  mountingHoleDefaultData,
  jumperDefaultData,
  cutoutDefaultData,
  netLabelDefaultData,
  powerRailDefaultData,
} from './partDefaults';
import { OpAmpProperties } from './OpAmpNode';
import { NetLabelProperties } from './NetLabelNode';
import { PowerRailProperties } from './PowerRailNode';

export const nodeRegistry: Record<string, NodeMeta> = {
  voltage: { Properties: VoltageProperties },
  acvoltage: { Properties: ACVoltageProperties },
  resistor: { Properties: ResistorProperties },
  capacitor: { Properties: CapacitorProperties },
  inductor: { Properties: InductorProperties },
  switch: { Properties: SwitchProperties },
  led: { Properties: LEDProperties },
  signalgen: { Properties: SignalGeneratorProperties },
  mcu: { Properties: MicrocontrollerProperties },
  npn: { Properties: BJTProperties },
  pnp: { Properties: BJTProperties },
  nmos: { Properties: MosfetProperties },
  pmos: { Properties: MosfetProperties },
  opamp: { Properties: OpAmpProperties },
  diode: { Properties: DiodeProperties },
  zener: { Properties: ZenerDiodeProperties },
  microphone: { Properties: MicrophoneProperties },
  speaker: { Properties: SpeakerProperties },
  scope: { Properties: ScopeProperties },
  multimeter: { Properties: MultimeterProperties },
  potentiometer: { Properties: PotentiometerProperties },
  transformer: { Properties: TransformerProperties, defaultData: transformerDefaultData },
  dff: { Properties: DFlipFlopProperties, defaultData: dffDefaultData },
  ldr: { Properties: LDRProperties, defaultData: ldrDefaultData },
  sevenseg: { Properties: SevenSegmentProperties },
  currentsource: { Properties: CurrentSourceProperties },
  heltec_v4: { Properties: HeltecV4Properties, defaultData: heltecV4DefaultData },
  // Mechanical / board-only parts. They never reach the SPICE netlist.
  pinheader: { Properties: PinHeaderProperties, defaultData: pinHeaderDefaultData },
  via: { Properties: ViaProperties, defaultData: viaDefaultData },
  mountinghole: { Properties: MountingHoleProperties, defaultData: mountingHoleDefaultData },
  jumper: { Properties: JumperProperties, defaultData: jumperDefaultData },
  cutout: { Properties: CutoutProperties, defaultData: cutoutDefaultData },
  // Named nets: connectivity by name rather than by wire.
  netlabel: { Properties: NetLabelProperties, defaultData: netLabelDefaultData },
  powerrail: { Properties: PowerRailProperties, defaultData: powerRailDefaultData },
};
