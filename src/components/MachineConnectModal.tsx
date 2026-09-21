import React from 'react';
import { ProbeCircuitStatus } from './ProbeCircuitStatus';
import { JobOverrides } from './JobOverrides';
import {
  X,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Plug,
  RefreshCw,
  Home,
  Unlock,
} from 'lucide-react';
import { NumberInput } from '@physbox-io/ui';
import { TeknoBoxPicker } from './TeknoBoxPicker';
import type { MachineState } from '../utils/webSerialManager';

/**
 * The bench: everything that is true of the machine rather than of a board.
 *
 * This used to be the third tab of the export panel, next to Layout and CAM,
 * which put the connection, the jog keypad and the zeros behind a tab you had
 * to leave the board to reach — and put them *away* the moment you went back
 * to look at it. A dialog can sit over whichever tab is open, and the Connect
 * control that raises it carries the one piece of machine state the rest of
 * the panel needs to show all the time: whether there is a machine attached.
 *
 * The line it draws is "does this need a board to make sense". Framing and
 * surface probing both do — the frame traces the board's outline, and the mesh
 * is probed inside it — so both live with the board, on the CAM tab. What is
 * left here needs nothing but the machine: the link, the alarm, the jog, the
 * work origin, and the two bench measurements the zeros are set against.
 */

export interface MachineConnectModalProps {
  onClose: () => void;
  /**
   * True when this is the only thing on screen — reached from the spanner in
   * the status bar rather than from inside the board panel. It gets its own
   * backdrop; opened from the panel it does not, since the panel is already
   * dimming everything behind it and two stacked scrims go nearly black.
   */
  standalone?: boolean;

  serialState: MachineState;
  busy: '' | 'probing' | 'zeroing' | 'milling' | 'framing' | 'homing';
  machineBusy: boolean;
  manualMoveBlocked: boolean;
  isRunning: boolean;

  /** Last failure worth showing, already merged from the app and the machine. */
  error: string | null;
  onDismissError: () => void;

  transportMode: 'usb' | 'wifi';
  onTransportModeChange: (mode: 'usb' | 'wifi') => void;
  cloudDeviceId: string;
  onCloudDeviceIdChange: (id: string) => void;
  onPairedBox: (deviceId: string) => void;

  onConnect: () => void;
  onDisconnect: () => void;
  onUnlock: () => void;
  onHome: () => void;
  onPause: () => void;

  jogStep: number;
  onJogStepChange: (mm: number) => void;
  onJog: (axis: 'X' | 'Y' | 'Z', direction: 1 | -1) => void;

  onZeroXY: () => void;
  onZeroZOnCopper: () => void;
  onZeroZOnPlate: () => void;
  onGoToZero: () => void;
  touchPlateMm: number;
  onTouchPlateChange: (mm: number) => void;

  safeZMm: number;
  onSafeZChange: (mm: number) => void;}

const panel =
  'p-3 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg';
const jogButton =
  'w-10 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 rounded ' +
  'flex items-center justify-center cursor-pointer';
const quietButton =
  'py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 rounded ' +
  'font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer';

export const MachineConnectModal: React.FC<MachineConnectModalProps> = ({
  onClose,
  standalone = false,
  serialState,
  busy,
  machineBusy,
  manualMoveBlocked,
  isRunning,
  error,
  onDismissError,
  transportMode,
  onTransportModeChange,
  cloudDeviceId,
  onCloudDeviceIdChange,
  onPairedBox,
  onConnect,
  onDisconnect,
  onUnlock,
  onHome,
  onPause,
  jogStep,
  onJogStepChange,
  onJog,
  onZeroXY,
  onZeroZOnCopper,
  onZeroZOnPlate,
  onGoToZero,
  touchPlateMm,
  onTouchPlateChange,
  safeZMm,
  onSafeZChange,
}) => {
  /*
   * "The origin exists" rather than "the tool is sitting on it".
   *
   * Every zero is followed by jogging off it — that is what zeroing is for —
   * and the `Confirmed` flags describe the tool's position, so they go out the
   * moment the next jog is sent. Reporting those as the zeroing status is what
   * had the panel calling a zeroed machine un-zeroed. What survives the jog is
   * the datum, and the datum is what everything downstream needs.
   */
  const xyZeroed = !!serialState.zeroXYSet || !!serialState.zeroRestored;
  const zZeroed = !!serialState.zeroZSet || !!serialState.zeroRestored;

  return (
    <div
      className={`fixed inset-0 z-[100000] flex items-center justify-center p-4 ${
        standalone ? 'bg-black/60 backdrop-blur-xs' : 'bg-black/25'
      }`}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Two columns from `lg` up. In one column this was a tall strip that had
          to be scrolled past the jog keypad to reach the board map — the two
          things an operator switches between most. */}
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-100/70 dark:bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-1.5 rounded-lg border ${
                serialState.connected
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  : 'bg-slate-500/10 border-slate-500/20 text-slate-500 dark:text-slate-400'
              }`}
            >
              <Plug className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Machine</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {serialState.connected
                  ? `Connected (${serialState.portName || 'Serial'}) — ${serialState.status}`
                  : 'Not connected'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="p-4 text-xs overflow-y-auto">
          <div className="space-y-3">
            {/* A failure is worth one banner, and one that can be put away:
                `lastError` is written by an alarm and then never retracted, so
                without a dismiss the first bad probe of the session stayed on
                screen behind every good one that followed. */}
            {error && (
              <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-700 dark:text-red-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span className="flex-1">{error}</span>
                <button
                  onClick={onDismissError}
                  className="shrink-0 p-0.5 hover:bg-red-500/20 rounded cursor-pointer"
                  title="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* --- Connection ------------------------------------------------ */}
            <div className={`${panel} space-y-2.5`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  GRBL machine connection
                </span>
                {serialState.connected ? (
                  <button
                    onClick={onDisconnect}
                    disabled={machineBusy}
                    className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 font-semibold rounded cursor-pointer"
                    title={machineBusy ? 'Finish or cancel the current operation first' : 'Close the link and release the port'}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={onConnect}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded cursor-pointer"
                  >
                    {transportMode === 'wifi' ? 'Connect WiFi' : 'Connect Serial'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {(['usb', 'wifi'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => onTransportModeChange(mode)}
                    disabled={serialState.connected}
                    className={`py-1.5 rounded text-[11px] font-semibold border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      transportMode === mode
                        ? 'bg-emerald-100 dark:bg-emerald-600/30 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                        : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {mode === 'usb' ? 'USB (Web Serial)' : 'WiFi'}
                  </button>
                ))}
              </div>

              {/* WiFi means a Tekno Box, reached through physbox rather than by
                  address: the box is behind the customer's router with nothing to
                  dial, and a page on https may not open a plain connection to a
                  home network in any case. */}
              {transportMode === 'wifi' && (
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold block">
                    Tekno Box
                  </label>
                  <TeknoBoxPicker
                    value={cloudDeviceId}
                    onChange={onCloudDeviceIdChange}
                    onPaired={onPairedBox}
                    disabled={serialState.connected}
                    accentClass="bg-emerald-600 hover:bg-emerald-500 text-white"
                  />
                </div>
              )}
            </div>

            {/* Alarm banner. GRBL boots into Alarm whenever homing is enabled,
                and lands there again after a limit trip or a failed probe,
                refusing every G-code line with error:9 until it is cleared. */}
            {serialState.status === 'ALARM' && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-600/60 rounded-lg text-amber-700 dark:text-amber-300 text-[11px] leading-relaxed">
                <span className="font-semibold">Machine is in alarm.</span> It will reject every
                command (error:9) until it is unlocked or homed.
              </div>
            )}

            <div className={`${panel} space-y-2`}>
              <div className="font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                Machine controls
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={onUnlock}
                  disabled={!!busy || !serialState.connected}
                  title="Clear a GRBL alarm lockout"
                  className="py-1.5 rounded text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Unlock ($X)
                </button>
                <button
                  onClick={onHome}
                  disabled={!!busy || !serialState.connected}
                  title="Run the homing cycle"
                  className={`${quietButton} border border-slate-400 dark:border-slate-600`}
                >
                  {busy === 'homing' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Home className="w-3.5 h-3.5" />
                  )}
                  {busy === 'homing' ? 'Homing…' : 'Home ($H)'}
                </button>
              </div>
            </div>

            {isRunning && (
              <button
                onClick={onPause}
                className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded font-semibold cursor-pointer"
              >
                Pause job
              </button>
            )}

            {/* Next to Pause, because it is the other thing you reach for when
                a cut is going wrong — and the one that does not cost you the
                registration between the board and the mesh. */}
            <JobOverrides serialState={serialState} />

          </div>

          {/* Left is the bench in the order it is used — connect, clear the
              alarm, jog to the corner, set the zeros. Right is the board map,
              which is a picture rather than a control and wants the width. */}
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            <div className="space-y-3">
              {/* --- Jog -------------------------------------------------------- */}
              <div className={`${panel} space-y-2`}>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-300 font-semibold">
                  <span className="flex items-center gap-1">
                    <Crosshair className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Manual jog
                  </span>
                  <div className="flex gap-1 text-[10px]">
                    {[0.1, 1.0, 10.0].map(st => (
                      <button
                        key={st}
                        onClick={() => onJogStepChange(st)}
                        className={`px-1.5 py-0.5 rounded cursor-pointer ${
                          jogStep === st
                            ? 'bg-emerald-500 text-white font-bold'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {st}mm
                      </button>
                    ))}
                  </div>
                </div>

                {/* Two controls, not one nine-cell keypad. X and Y are a plane
                    and read as a compass rose; Z is a separate axis and the only
                    one that can drive the bit into the work. Spreading Z+ and Z-
                    into the corners of a 3x3 grid put a whole row between them
                    and left each one sitting alongside a Y arrow it has nothing
                    to do with. Stacked and set apart, the pair reads as the axis
                    it is, and the gap is a thumb's width of protection. */}
                <div className="flex items-center justify-center gap-4 py-1">
                  <div className="grid grid-cols-3 gap-1.5 items-center justify-items-center">
                    <div />
                    <button onClick={() => onJog('Y', 1)} disabled={manualMoveBlocked} className={jogButton} title="Jog Y+">
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <div />

                    <button onClick={() => onJog('X', -1)} disabled={manualMoveBlocked} className={jogButton} title="Jog X-">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    {/* The centre of a jog cross is where every other machine
                        control puts "go home", so a button here read as one — and
                        setting the work origin is the one action on this panel you
                        cannot undo by jogging back. It lives below with the other
                        zeros, named. */}
                    <div className="w-10 h-8 flex items-center justify-center text-slate-300 dark:text-slate-700" aria-hidden>
                      <Crosshair className="w-3.5 h-3.5" />
                    </div>
                    <button onClick={() => onJog('X', 1)} disabled={manualMoveBlocked} className={jogButton} title="Jog X+">
                      <ArrowRight className="w-4 h-4" />
                    </button>

                    <div />
                    <button onClick={() => onJog('Y', -1)} disabled={manualMoveBlocked} className={jogButton} title="Jog Y-">
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <div />
                  </div>

                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      onClick={() => onJog('Z', 1)}
                      disabled={manualMoveBlocked}
                      className={`${jogButton} text-[10px] font-bold`}
                      title="Jog Z+ (up, away from the work)"
                    >
                      Z+
                    </button>
                    <button
                      onClick={() => onJog('Z', -1)}
                      disabled={manualMoveBlocked}
                      className={`${jogButton} text-[10px] font-bold`}
                      title="Jog Z− (down, into the work)"
                    >
                      Z−
                    </button>
                  </div>
                </div>

                <div className="text-center text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  X {serialState.wpos.x.toFixed(2)} &nbsp; Y {serialState.wpos.y.toFixed(2)} &nbsp; Z{' '}
                  {serialState.wpos.z.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {/* --- Work origin ------------------------------------------------ */}
              <div className={`${panel} space-y-2`}>
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Work origin
                </p>

                {/* XY first because that is the order it is done in: park the bit on
                    the corner of the blank, fix X0 Y0 there, then probe Z on the
                    copper. */}
                <button
                  onClick={onZeroXY}
                  disabled={machineBusy}
                  title="Sets the work origin X0 Y0 at the tool's current position (G10 L20)"
                  className={`w-full py-1.5 rounded font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    xyZeroed
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                  }`}
                >
                  {xyZeroed ? <Check className="w-3.5 h-3.5" /> : <Crosshair className="w-3.5 h-3.5" />}
                  {xyZeroed ? 'Re-set XY0 here' : 'Set XY0 at this spot'}
                </button>
                <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-normal">
                  Jog the bit over the front-left corner of the blank first — everything the job cuts is
                  measured from the spot you set here.
                </p>

                <div className="flex gap-2">
                  <button
                    onClick={onZeroZOnCopper}
                    disabled={manualMoveBlocked}
                    title="Probe straight onto the copper, using the continuity clip"
                    className={`${quietButton} flex-1`}
                  >
                    {busy === 'zeroing' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    Probe Z0 on copper
                  </button>
                  <button
                    onClick={onZeroZOnPlate}
                    disabled={manualMoveBlocked}
                    title={`Probe onto the touch plate and set Z0 ${touchPlateMm}mm below the contact point`}
                    className={`${quietButton} flex-1`}
                  >
                    Probe Z0 on plate
                  </button>
                </div>
                <ProbeCircuitStatus
                  active={serialState.probePinActive}
                  seen={serialState.probeCircuitSeen}
                />

                {/* Go to XY zero. Enabled on the *datum*, not on the tool standing
                    at it — the reason to press this is that the tool is somewhere
                    else. Z still has to be set, because the move lifts before it
                    travels and an unset Z means it does not know how far up is. */}
                <button
                  onClick={onGoToZero}
                  disabled={manualMoveBlocked || !zZeroed}
                  title={
                    zZeroed
                      ? `Lift Z to the ${safeZMm}mm retract, then rapid back to the work origin (X0 Y0)`
                      : 'Set Z zero first — the move lifts to the retract height before it travels, and without a Z datum it cannot know where that is'
                  }
                  className={`${quietButton} w-full`}
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  Go to XY zero
                </button>

                {/* Setting the work origin is otherwise silent: the button sends a
                    line, GRBL says nothing a human sees, and the only evidence is
                    the DRO changing. */}
                <div className="space-y-0.5 text-[10px] font-semibold pt-0.5">
                  {serialState.zeroXYPending ? (
                    <div className="text-amber-600 dark:text-amber-400">
                      XY zeroing — waiting for the machine to confirm…
                    </div>
                  ) : xyZeroed ? (
                    <div className="text-emerald-600 dark:text-emerald-400">
                      XY0 set{serialState.zeroXYConfirmed ? ' — the tool is standing on it' : ''}
                    </div>
                  ) : (
                    <div className="text-slate-500 dark:text-slate-400">XY0 not set this session</div>
                  )}
                  {serialState.zeroZPending ? (
                    <div className="text-amber-600 dark:text-amber-400">
                      Z zeroing — waiting for the machine to confirm…
                    </div>
                  ) : zZeroed ? (
                    <div className="text-emerald-600 dark:text-emerald-400">
                      Z0 set at {(serialState.zeroZTargetMm ?? 0).toFixed(2)}mm
                      {serialState.zeroZScatterMm !== undefined
                        ? ` (${serialState.zeroZScatterMm.toFixed(3)}mm scatter)`
                        : ''}
                    </div>
                  ) : (
                    <div className="text-slate-500 dark:text-slate-400">Z0 not set this session</div>
                  )}
                </div>

                {/* The zeros outlive the tab. Closing it mid-job used to lose the
                    only record of where the origin was, and a re-zero by eye does
                    not land back on the same spot. */}
                {serialState.savedZero && (
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    Remembered from last session
                    {serialState.zeroRestored ? ' — restored onto the machine' : ''}{' '}
                    ({(['x', 'y', 'z'] as const)
                      .filter(a => serialState.savedZero![a] !== undefined)
                      .map(a => `${a.toUpperCase()} ${serialState.savedZero![a]!.toFixed(2)}`)
                      .join(' ')})
                  </div>
                )}

                {/* The plate thickness is what makes plate-probing land on the right
                    Z — a wrong number here is a wrong cut depth on every path, so it
                    is edited right next to the button that uses it. */}
                {/* Both are bench measurements rather than properties of a
                    board — the plate on the shelf, the height this machine
                    travels at — so they outlive any one job and belong here
                    with the zeros they set. */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                      Touch plate (mm)
                    </label>
                    <NumberInput
                      step={0.1}
                      min={0.1}
                      value={touchPlateMm}
                      disabled={machineBusy}
                      onChange={onTouchPlateChange}
                      className="w-full px-2 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-mono text-[11px] disabled:opacity-40"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                      Retract / safe Z (mm)
                    </label>
                    <NumberInput
                      step={0.5}
                      min={0.5}
                      value={safeZMm}
                      disabled={machineBusy}
                      onChange={onSafeZChange}
                      className="w-full px-2 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-mono text-[11px] disabled:opacity-40"
                    />
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
