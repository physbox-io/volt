import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Wifi, WifiOff, ExternalLink } from 'lucide-react';
import { memo } from 'react';
import type { NodePropertiesProps } from './registry';
import { DEVICE_CARD_DARK } from './schematic';
import { NumberInput } from '../NumberInput';

export const HELTEC_V4_GPIO_PINS = ['GPIO_1', 'GPIO_3', 'GPIO_33', 'GPIO_36', 'GPIO_37', 'GPIO_41'];

export function heltecV4DefaultData() {
  return {
    label: 'Heltec V4',
    ip: '192.168.1.244',
    hilExecutionMode: 'native',
    hilMemoizationEnabled: true,
    hilInputDP: 3,
    hilIcDP: 3,
    hilMaxConsecutiveHits: 50,
    pins: {
      GPIO_1: 'analog_in',
      GPIO_3: 'digital_out',
      GPIO_33: 'digital_in',
      GPIO_36: 'digital_in',
      GPIO_37: 'digital_in',
      GPIO_41: 'digital_in'
    },
    pinVoltages: {
      GPIO_1: 0.0,
      GPIO_3: 0.0,
      GPIO_33: 0.0,
      GPIO_36: 0.0,
      GPIO_37: 0.0,
      GPIO_41: 0.0
    },
    // Opt-in: nothing contacts the board over ws:// until the user clicks Connect on
    // the node (or starts a HIL run). Auto-connecting from an https page is blocked as
    // mixed content and can take WebSerial down with it.
    hilEnabled: false,
    isConnected: false
  };
}

export function HeltecV4Properties({ node, updateData, isSimulating }: NodePropertiesProps) {
  const memoEnabled = node.data.hilMemoizationEnabled ?? true;
  const inputDP = node.data.hilInputDP ?? 3;
  const icDP = node.data.hilIcDP ?? 3;
  const maxHits = node.data.hilMaxConsecutiveHits ?? 50;
  const stats = node.data.hilStats || null;

  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">CYD Board Wi-Fi IP</label>
        <input
          type="text"
          value={(node.data.ip as string) || '192.168.1.244'}
          onChange={e => updateData('ip', e.target.value)}
          className="w-full text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none mb-2"
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">HIL Execution Mode</label>
        <select
          value={(node.data.hilExecutionMode as string) || 'native'}
          disabled={isSimulating}
          onChange={e => updateData('hilExecutionMode', e.target.value)}
          className={`w-full text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none ${isSimulating ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={isSimulating ? "Stop the simulation to change HIL execution mode." : "Native: whole slice runs in one UART transaction on the Heltec's own C++ firmware (needs firmware with the hil_batch handler). Legacy: CYD loops gpio_write/adc_read per op — one blocking ~11ms UART round trip each, works against any firmware."}
        >
          <option value="native">Native (single UART transaction)</option>
          <option value="legacy">Legacy (per-op UART)</option>
        </select>
      </div>

      {/* State Memoization (Caching) Settings */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-3 mt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">State Memoization (Cache)</h4>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={memoEnabled}
              onChange={e => updateData('hilMemoizationEnabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-7 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
          </label>
        </div>

        {memoEnabled && (
          <div className="space-y-2 bg-slate-50 dark:bg-slate-950/50 p-2 rounded border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">Input Precision (DP)</span>
              <select
                value={inputDP}
                onChange={e => updateData('hilInputDP', parseInt(e.target.value, 10))}
                className="text-xs border border-gray-300 dark:border-slate-800 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
              >
                <option value={1}>1 DP (0.1V)</option>
                <option value={2}>2 DP (10mV)</option>
                <option value={3}>3 DP (1mV)</option>
                <option value={4}>4 DP (0.1mV)</option>
              </select>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">Initial Cond. (DP)</span>
              <select
                value={icDP}
                onChange={e => updateData('hilIcDP', parseInt(e.target.value, 10))}
                className="text-xs border border-gray-300 dark:border-slate-800 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
              >
                <option value={1}>1 DP (0.1V)</option>
                <option value={2}>2 DP (10mV)</option>
                <option value={3}>3 DP (1mV)</option>
                <option value={4}>4 DP (0.1mV)</option>
              </select>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">Max Hit Limit</span>
              <NumberInput
                min={5}
                max={500}
                value={maxHits}
                onChange={v => updateData('hilMaxConsecutiveHits', v)}
                      className="w-16 text-xs border border-gray-300 dark:border-slate-800 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-right"
                      integer
                    />
            </div>

            {stats && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[10px] font-mono space-y-1">
                <div className="flex justify-between text-slate-700 dark:text-slate-300 font-bold">
                  <span>Hit Rate:</span>
                  <span className="text-emerald-500">{stats.hitRatePct}%</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Hits / Misses:</span>
                  <span>{stats.hits} / {stats.misses}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Cache Size:</span>
                  <span>{stats.entryCount} entries</span>
                </div>
                <button
                  type="button"
                  onClick={() => updateData('hilClearCacheRequested', Date.now())}
                  className="w-full mt-1.5 text-[10px] py-0.5 px-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded font-sans transition-colors"
                >
                  Clear Cache
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 pt-2 mt-2">
        <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Pin Configurations</h4>
        {HELTEC_V4_GPIO_PINS.map(pinId => {
          const currentPins = node.data.pins || {};
          const pinVal = currentPins[pinId] || 'digital_in';
          return (
            <div key={pinId} className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-slate-600 dark:text-slate-400">{pinId.replace('_', ' ')}</span>
              <select
                value={pinVal}
                onChange={e => {
                  const nextPins = { ...currentPins, [pinId]: e.target.value };
                  updateData('pins', nextPins);
                }}
                className="text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-0.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="digital_in">Digital In</option>
                <option value="analog_in">Analog In (ADC)</option>
                <option value="digital_out">Digital Out</option>
              </select>
            </div>
          );
        })}
      </div>
    </>
  );
}

export const HeltecV4Node = memo(function HeltecV4Node({ id, data, selected }: any) {
  const { setNodes } = useReactFlow();
  const isConnected = !!data.isConnected;
  const hilEnabled = !!data.hilEnabled;

  const toggleHil = () => {
    setNodes((nds: any[]) => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, hilEnabled: !hilEnabled } } : n
    ));
  };
  const pins = data.pins || {};
  const pinVoltages = data.pinVoltages || {};

  const getPinColor = (pinId: string) => {
    const mode = pins[pinId] || 'digital_in';
    if (mode === 'analog_in') return '!bg-green-500';
    if (mode === 'digital_in') return '!bg-amber-500';
    return '!bg-emerald-500';
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
        />
        <Handle
          type="source"
          position={position}
          id={pinId}
          className={`w-2 h-2 ${getPinColor(pinId)} !border-gray-900 ${offsetClass} opacity-0 pointer-events-none`}
        />
      </>
    );
  };

  return (
    <div className={`${DEVICE_CARD_DARK} w-44 text-slate-100 flex flex-col transition-all duration-300 ${selected ? '!border-violet-500' : ''}`}>
      
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
          <button
            type="button"
            onClick={toggleHil}
            className="nodrag flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-slate-900 transition-colors"
            title={hilEnabled
              ? 'Disconnect from the board (stops the ws:// connection)'
              : 'Connect to the board over ws:// — only works from a plain-http page or over a secure tunnel'}
          >
            {isConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span className="text-[8px] text-emerald-400 font-mono">CONNECTED</span>
              </>
            ) : hilEnabled ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="text-[8px] text-amber-400 font-mono">CONNECTING</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-[8px] text-slate-500 font-mono">CONNECT</span>
              </>
            )}
          </button>
        </div>
      </div>

      {data.hilError && (
        <div className="px-3 py-1.5 text-[8px] font-mono text-rose-400 bg-rose-950/40 border-b border-rose-900/50 leading-snug">
          {data.hilError}
        </div>
      )}

      {/* Pins layout */}
      <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-3 relative">
        
        {/* Left Side Pins */}
        <div className="flex flex-col gap-2 items-start">
          
          {/* 3V3 */}
          <div className="relative flex items-center h-4">
            <Handle type="source" position={Position.Left} id="3V3" className="w-2 h-2 !bg-red-500 !border-gray-900 -ml-5" />
            <Handle type="target" position={Position.Left} id="3V3" className="w-2 h-2 !bg-red-500 !border-gray-900 -ml-5 opacity-0 pointer-events-none" />
            <span className="text-[9px] font-bold text-red-400 font-mono">3V3</span>
          </div>

          {/* GND */}
          <div className="relative flex items-center h-4">
            <Handle type="source" position={Position.Left} id="GND" className="w-2 h-2 !bg-slate-500 !border-gray-900 -ml-5" />
            <Handle type="target" position={Position.Left} id="GND" className="w-2 h-2 !bg-slate-500 !border-gray-900 -ml-5 opacity-0 pointer-events-none" />
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
        <div className="flex flex-col gap-2 items-end">
          
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
