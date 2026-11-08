import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Square, Wrench } from 'lucide-react';
import { jobInProgress, stopControl } from '../utils/machineGates';
import { JobWaitingButton, jobPauseKind, readMachineLink } from '@physbox-io/ui';
import { webSerialManager } from '../utils/webSerialManager';
import { jobPause } from '../utils/jobPause';

interface Summary {
  connected: boolean;
  status: string;
  stop: ReturnType<typeof stopControl>;
  job: boolean;
  line: number;
  total: number;
  percent: number;
  message?: string;
  needsZero: boolean;
}

function summarise(): Summary {
  const s = webSerialManager.getState();
  return {
    connected: s.connected,
    status: s.status,
    stop: stopControl(s),
    job: jobInProgress(s),
    line: s.currentLine,
    total: s.totalLines,
    percent: s.progressPercent,
    message: s.pauseMessage,
    needsZero: !!s.needsZeroBeforeResume,
  };
}

const same = (a: Summary, b: Summary) =>
  (Object.keys(a) as (keyof Summary)[]).every(key => a[key] === b[key]);

let resumeAttempted = false;

/**
 * The machine, its job and its stop, with every dialog closed.
 *
 * Subscribing to `webSerialManager` at the root of `App` re-rendered the entire
 * schematic canvas on every GRBL `?` status report and streamed G-code line.
 * Holding the subscription here, and bailing out when nothing shown has changed,
 * keeps high-frequency DRO ticks out of the React tree.
 */
export function MachineStatusBar({ onOpenMachine }: { onOpenMachine: () => void }) {
  const [summary, setSummary] = useState(summarise);
  /*
   * Picks the machine back up once at app start. USB only to the port this
   * origin was granted before (`autoConnect`): a port prompt must never be
   * raised unprompted. Silent on failure: the box may simply be asleep.
   */
  useEffect(() => {
    if (resumeAttempted || webSerialManager.getState().connected) return;
    resumeAttempted = true;
    const link = readMachineLink();
    if (link.kind === 'usb') {
      void webSerialManager.autoConnect().catch(() => {});
      return;
    }
    if (!link.deviceId) return;
    webSerialManager.setTransport('wifi', link.deviceId);
    void webSerialManager.connect().catch(() => {});
  }, []);
  useEffect(
    () =>
      webSerialManager.addListener(() => {
        const next = summarise();
        setSummary(prev => (same(prev, next) ? prev : next));
      }),
    [],
  );

  const paused = summary.status.startsWith('PAUSED');

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2 h-2 rounded-full ${
          summary.connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400 dark:bg-slate-600'
        }`}
      />
      <span>Machine:</span>
      <span
        className={
          summary.connected
            ? 'text-emerald-600 dark:text-emerald-400 font-bold'
            : 'text-slate-400'
        }
      >
        {summary.status}
      </span>
      <button
        onClick={onOpenMachine}
        className="p-1 rounded text-amber-600 dark:text-amber-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        title="Connect the machine, home it, and set the work origin"
      >
        <Wrench className="w-3.5 h-3.5" />
      </button>

      {summary.job && (
        <>
          <div className="w-px h-3 bg-slate-200 dark:bg-slate-800" />
          <span className="font-mono text-slate-700 dark:text-slate-200">
            {paused ? 'Paused' : 'Cutting'} {summary.line}/{summary.total}
          </span>
          <div
            className="w-20 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"
            title="How far through the job the cutter is"
          >
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, summary.percent)}%` }}
            />
          </div>
          {summary.message && (
            <span className="text-amber-600 dark:text-amber-400 truncate max-w-[22rem]">{summary.message}</span>
          )}
          {/* Paused, the way back to the dialog: Resume and the re-zero are
              there, and Hide only ever tucked them away. */}
          {paused && (
            <JobWaitingButton
              kind={summary.status === 'PAUSED_TOOL' ? 'tool' : (jobPauseKind(summary.status) ?? 'hold')}
              needsZero={summary.needsZero}
              onOpen={() => jobPause.show()}
            />
          )}
          {!paused && (
            <button
              onClick={() => void webSerialManager.pauseJob()}
              title="Pause the job"
              className="p-0.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
        </>
      )}

      {/* On the body so it stays above the mill dialog and every other window. */}
      {summary.stop &&
        createPortal(
          <button
            onClick={() =>
              void (summary.stop === 'job' ? webSerialManager.cancelJob() : webSerialManager.eStop())
            }
            title={
              summary.stop === 'job'
                ? 'E-Stop: soft reset. Stops the machine now and loses the position. The line it reached is kept, to run from.'
                : 'Soft reset: stops the machine now. If it was moving, the position is lost and it wants homing.'
            }
            className="fixed bottom-1 right-4 z-[100001] flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold shadow-lg cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" />
            <span>{summary.stop === 'job' ? 'E-Stop' : 'Stop machine'}</span>
          </button>,
          document.body,
        )}
    </div>
  );
}
