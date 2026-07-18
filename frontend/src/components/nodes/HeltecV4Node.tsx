import { Handle, Position } from '@xyflow/react';
import { Wifi, WifiOff, ExternalLink } from 'lucide-react';
import { memo } from 'react';

export const HeltecV4Node = memo(function HeltecV4Node({ data, selected }: any) {
  const isConnected = !!data.isConnected;
  const pins = data.pins || {};
  const pinVoltages = data.pinVoltages || {};

  const getPinColor = (pinId: string) => {
    const mode = pins[pinId] || 'digital_in';
    if (mode === 'analog_in') return '!bg-green-500';
    if (mode === 'digital_in') return '!bg-amber-500';
    return '!bg-blue-500';
  };

  const formatPinValue = (pinId: string) => {
    const mode = pins[pinId] || 'digital_in';
    const volt = pinVoltages[pinId] ?? 0.0;
    if (mode === 'analog_in') {
      return `${volt.toFixed(2)}V`;
    }
    return volt > 0.8 ? '1' : '0';
  };

  const renderHandle = (pinId: string, position: Position, offsetClass: string) => {
    return (
      <>
        <Handle
          type="target"
          position={position}
          id={pinId}
          className={`w-2 h-2 ${getPinColor(pinId)} !border-gray-900 ${offsetClass}`}
          style={{ top: 'auto' }}
        />
        <Handle
          type="source"
          position={position}
          id={pinId}
          className={`w-2 h-2 ${getPinColor(pinId)} !border-gray-900 ${offsetClass} opacity-0 pointer-events-none`}
          style={{ top: 'auto' }}
        />
      </>
    );
  };

  return (
    <div className={`bg-slate-900 border-2 rounded-lg w-52 shadow-2xl text-slate-100 flex flex-col transition-all duration-300 ${selected ? 'border-violet-500 shadow-violet-500/20' : 'border-slate-800'}`}>
      
      {/* Header */}
      <div className="bg-slate-950 text-[10px] font-bold text-center py-2 px-3 uppercase tracking-wider rounded-t-lg flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-1.5">
          <span className="text-violet-400">Heltec V3/V4</span>
          <a
            href={`http://${data.ip || '192.168.1.244'}`}
            target="_blank"
            rel="noopener noreferrer"
            className="nodrag text-violet-400/60 hover:text-violet-300 transition-colors p-0.5 rounded hover:bg-slate-900"
            title="Open web interface in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
        <div className="flex items-center gap-1.5">
          {isConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span className="text-[8px] text-emerald-400 font-mono">CONNECTED</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[8px] text-slate-500 font-mono">OFFLINE</span>
            </>
          )}
        </div>
      </div>

      {/* Pins layout */}
      <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-3 relative">
        
        {/* Left Side Pins */}
        <div className="flex flex-col gap-2.5 items-start">
          
          {/* 3V3 */}
          <div className="relative flex items-center h-4">
            <Handle type="source" position={Position.Left} id="3V3" className="w-2 h-2 !bg-red-500 !border-gray-900 -ml-5" style={{ top: 'auto' }} />
            <Handle type="target" position={Position.Left} id="3V3" className="w-2 h-2 !bg-red-500 !border-gray-900 -ml-5 opacity-0 pointer-events-none" style={{ top: 'auto' }} />
            <span className="text-[9px] font-bold text-red-400 font-mono">3V3</span>
          </div>

          {/* GND */}
          <div className="relative flex items-center h-4">
            <Handle type="source" position={Position.Left} id="GND" className="w-2 h-2 !bg-slate-500 !border-gray-900 -ml-5" style={{ top: 'auto' }} />
            <Handle type="target" position={Position.Left} id="GND" className="w-2 h-2 !bg-slate-500 !border-gray-900 -ml-5 opacity-0 pointer-events-none" style={{ top: 'auto' }} />
            <span className="text-[9px] font-bold text-slate-400 font-mono">GND</span>
          </div>

          {/* GPIO 1 */}
          <div className="relative flex items-center h-4">
            {renderHandle('GPIO_1', Position.Left, '-ml-5')}
            <div className="flex flex-col leading-none">
              <span className="text-[9px] text-slate-300 font-mono font-semibold">GPIO 1</span>
              <span className="text-[7px] text-slate-500 font-mono uppercase tracking-tight">{pins.GPIO_1?.replace('_', ' ')} ({formatPinValue('GPIO_1')})</span>
            </div>
          </div>

          {/* GPIO 3 */}
          <div className="relative flex items-center h-4">
            {renderHandle('GPIO_3', Position.Left, '-ml-5')}
            <div className="flex flex-col leading-none">
              <span className="text-[9px] text-slate-300 font-mono font-semibold">GPIO 3</span>
              <span className="text-[7px] text-slate-500 font-mono uppercase tracking-tight">{pins.GPIO_3?.replace('_', ' ')} ({formatPinValue('GPIO_3')})</span>
            </div>
          </div>

        </div>

        {/* Right Side Pins */}
        <div className="flex flex-col gap-2.5 items-end">
          
          {/* GPIO 33 */}
          <div className="relative flex items-center justify-end h-4">
            <div className="flex flex-col leading-none items-end">
              <span className="text-[9px] text-slate-300 font-mono font-semibold">GPIO 33</span>
              <span className="text-[7px] text-slate-500 font-mono uppercase tracking-tight">{pins.GPIO_33?.replace('_', ' ')} ({formatPinValue('GPIO_33')})</span>
            </div>
            {renderHandle('GPIO_33', Position.Right, '-mr-5')}
          </div>

          {/* GPIO 36 */}
          <div className="relative flex items-center justify-end h-4">
            <div className="flex flex-col leading-none items-end">
              <span className="text-[9px] text-slate-300 font-mono font-semibold">GPIO 36</span>
              <span className="text-[7px] text-slate-500 font-mono uppercase tracking-tight">{pins.GPIO_36?.replace('_', ' ')} ({formatPinValue('GPIO_36')})</span>
            </div>
            {renderHandle('GPIO_36', Position.Right, '-mr-5')}
          </div>

          {/* GPIO 37 */}
          <div className="relative flex items-center justify-end h-4">
            <div className="flex flex-col leading-none items-end">
              <span className="text-[9px] text-slate-300 font-mono font-semibold">GPIO 37</span>
              <span className="text-[7px] text-slate-500 font-mono uppercase tracking-tight">{pins.GPIO_37?.replace('_', ' ')} ({formatPinValue('GPIO_37')})</span>
            </div>
            {renderHandle('GPIO_37', Position.Right, '-mr-5')}
          </div>

          {/* GPIO 41 */}
          <div className="relative flex items-center justify-end h-4">
            <div className="flex flex-col leading-none items-end">
              <span className="text-[9px] text-slate-300 font-mono font-semibold">GPIO 41</span>
              <span className="text-[7px] text-slate-500 font-mono uppercase tracking-tight">{pins.GPIO_41?.replace('_', ' ')} ({formatPinValue('GPIO_41')})</span>
            </div>
            {renderHandle('GPIO_41', Position.Right, '-mr-5')}
          </div>

        </div>

      </div>

      {/* Footer */}
      <div className="bg-slate-950/60 py-1.5 px-3 text-[7.5px] text-slate-400 rounded-b-lg font-mono tracking-wide border-t border-slate-800/40 flex items-center justify-center gap-1">
        <span>IP: {data.ip || '192.168.1.244'}</span>
        <a
          href={`http://${data.ip || '192.168.1.244'}`}
          target="_blank"
          rel="noopener noreferrer"
          className="nodrag text-slate-400 hover:text-slate-200 transition-colors p-0.5 rounded hover:bg-slate-900"
          title="Open web interface in new tab"
        >
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>

    </div>
  );
});
