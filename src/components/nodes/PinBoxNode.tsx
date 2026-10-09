import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { ElectromechNodeData } from '../../types/nodes';
import { DEVICE_CARD, DEVICE_TITLE, pinRow } from './schematicStyle';
import { SchematicLabel } from './schematic';
import { useDesignator } from './designatorContext';
import { PIN_BOX_PARTS, pinBoxOffset } from './pinBoxParts';

/** What a run measured, shown under the caption. */
function readout(type: string, data: ElectromechNodeData): string | null {
  if (type === 'dcmotor' || type === 'stepper') {
    if (data.rpm === undefined) return null;
    const angle = data.angleDeg === undefined ? '' : ` · ${data.angleDeg.toFixed(1)}°`;
    return `${data.rpm.toFixed(0)} rpm${angle}`;
  }
  if (type === 'fuse') return data.blown === undefined ? null : data.blown ? 'BLOWN' : 'intact';
  if (type === 'meshsignal') {
    if (!data.channel) return 'unbound';
    return data.signalValue === undefined ? data.channel : `${data.signalValue.toPrecision(3)}`;
  }
  return null;
}

/**
 * The symbol for every part in `PIN_BOX_PARTS`: a card with its caption, its
 * pins where the table puts them, and whatever the last run measured.
 */
export function PinBoxNode({ id, type, data, selected }: NodeProps<Node<ElectromechNodeData>>) {
  const part = PIN_BOX_PARTS[type];
  const designator = useDesignator(id, type, data?.name);
  if (!part) return null;
  const shown = readout(type, data);
  const blown = type === 'fuse' && data.blown;

  return (
    <div
      className={`${DEVICE_CARD} relative select-none ${selected ? 'ring-2 ring-blue-400' : ''}`}
      style={{ width: part.width, height: part.height }}
    >
      <div className={`${DEVICE_TITLE} absolute left-0 right-0 top-[5px] text-center`}>{part.title}</div>
      {part.pins.map(pin => {
        const { y } = pinBoxOffset(part, pin);
        const position = pin.side === 'left' ? Position.Left : Position.Right;
        const style = { top: pinRow(y) };
        return (
          <div key={pin.id}>
            <Handle type="target" position={position} id={pin.id} className="w-2 h-2 bg-slate-400 !border-0" style={style} />
            <Handle type="source" position={position} id={pin.id} className="w-2 h-2 bg-slate-400 !border-0" style={style} />
            {pin.label && (
              <span
                className="absolute font-mono text-[8px] leading-none text-slate-600 dark:text-slate-300 -translate-y-1/2"
                style={{ top: pinRow(y), [pin.side]: 4 }}
              >
                {pin.label}
              </span>
            )}
          </div>
        );
      })}
      {shown && (
        <div
          className={`absolute left-0 right-0 bottom-[4px] text-center font-mono text-[8px] leading-none ${blown ? 'text-red-600 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}
        >
          {shown}
        </div>
      )}
      <SchematicLabel placement="above" name={designator} />
    </div>
  );
}
