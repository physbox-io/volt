import type { ComponentType } from 'react';

export interface NodePropertiesProps {
  node: any;
  updateData: (key: string, value: any) => void;
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
  defaultData?: (label?: string) => Record<string, any>;
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
import { TransformerProperties, transformerDefaultData } from './TransformerNode';
import { DFlipFlopProperties, dffDefaultData } from './DFlipFlopNode';
import { LDRProperties, ldrDefaultData } from './LDRNode';
import { SevenSegmentProperties } from './SevenSegmentNode';
import { CurrentSourceProperties } from './CurrentSourceNode';
import { HeltecV4Properties, heltecV4DefaultData } from './HeltecV4Node';
import { PinHeaderProperties, pinHeaderDefaultData } from './PinHeaderNode';
import { ViaProperties, viaDefaultData } from './ViaNode';
import { MountingHoleProperties, mountingHoleDefaultData } from './MountingHoleNode';
import { JumperProperties, jumperDefaultData } from './JumperNode';
import { CutoutProperties, cutoutDefaultData } from './CutoutNode';
import { OpAmpProperties } from './OpAmpNode';

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
};
