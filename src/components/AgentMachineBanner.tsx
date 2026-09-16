import { useEffect, useState } from 'react';
import { Bot, Hand, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ArmingState } from '@physbox-io/machining';
import { machineArming, subscribeToArming } from '../utils/machineMcp';

/**
 * The one place a person says whether Claude may move the machine.
 *
 * This is the whole of the safety story made visible. Everything an agent can
 * do that moves an axis is refused until this is armed, and arming is
 * deliberately not something the agent can do for itself — it can ask, which
 * raises this to its attention state, and that is all.
 *
 * It lives in the navbar and is ALWAYS present, which took a bug to learn. It
 * used to hide itself whenever no machine was connected, on the reasoning that
 * most people never plug one in and a standing notice about something that
 * cannot happen to them is noise. That was wrong twice over:
 *
 *  - Connecting is itself a gated command, so hiding the control until a
 *    machine was connected meant it could never be armed, so the agent could
 *    never connect. The feature was unreachable from a cold start.
 *  - A permission control nobody can find is not a permission control. Someone
 *    has to know this exists *before* they need it, which means seeing it while
 *    they are not thinking about machines at all.
 *
 * So the idle state is a quiet chip rather than nothing, and it grows into a
 * banner when there is something to say.
 */
export function AgentMachineBanner() {
  const [arming, setArming] = useState<ArmingState>(() => machineArming.getState());
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeToArming(setArming), []);

  // Ticks only while the window is open, so the countdown stays honest without
  // a timer running for the whole session.
  useEffect(() => {
    if (!arming.armed) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [arming.armed]);

  /**
   * A refusal is worth showing for a while and then not.
   *
   * The agent asked, the person either answers or does not, and a banner that
   * kept insisting would be one they learn to ignore — which is the same
   * failure as arming and forgetting, from the other direction.
   */
  const asked =
    !arming.armed && arming.requestedAt !== undefined && now - arming.requestedAt < 60_000;

  if (asked) {
    return (
      <div className="flex shrink-0 items-center gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-200">
        <ShieldAlert size={14} className="shrink-0" />
        <span className="hidden sm:inline">
          Claude asked to <strong>{arming.requestedFor?.replace(/_/g, ' ')}</strong>
        </span>
        <button
          onClick={() => machineArming.arm()}
          className="shrink-0 cursor-pointer rounded-md bg-amber-500 px-2 py-1 font-medium text-white transition hover:bg-amber-400"
        >
          Allow
        </button>
      </div>
    );
  }

  if (!arming.armed) {
    return (
      <button
        onClick={() => machineArming.arm()}
        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 shadow-xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        title="Claude cannot move the machine. Click to let it jog, zero, probe and cut for the next hour — you can stop it at any time."
      >
        <ShieldCheck size={14} />
        <span className="hidden sm:inline">Machine locked</span>
      </button>
    );
  }

  const minutesLeft =
    arming.expiresAt !== undefined ? Math.max(0, Math.ceil((arming.expiresAt - now) / 60_000)) : 0;
  const last = arming.lastAgentCommand;
  // Only while it is fresh: a command from twenty minutes ago is history, not a
  // description of what the machine is doing now.
  const showLast = last && now - last.at < 30_000;

  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-200"
      title={`Claude may move the machine for another ${minutesLeft} minutes. Stop ends it immediately and cancels anything running.`}
    >
      <Bot size={14} className="shrink-0 animate-pulse" />
      <span className="shrink-0 font-medium">Claude can move this</span>
      {showLast && (
        <span className="hidden truncate font-mono text-emerald-600 md:inline dark:text-emerald-300/90">
          {last!.name.replace(/_/g, ' ')}
          {last!.detail ? ` ${last!.detail}` : ''}
        </span>
      )}
      <span className="shrink-0 text-emerald-600/70 dark:text-emerald-300/60">{minutesLeft}m</span>
      <button
        onClick={() => machineArming.disarm('operator')}
        className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 font-medium text-white transition hover:bg-emerald-500"
      >
        <Hand size={12} />
        Stop
      </button>
    </div>
  );
}
