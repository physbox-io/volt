import { useEffect, useState } from 'react';
import { Bot, Hand, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ArmingState } from '@physbox-io/machining';
import { machineArming, subscribeToArming } from '../utils/machineMcp';

/**
 * Said once, in one place, so both states and the tooltip cannot drift apart —
 * and so an agent's refusal message can quote the same words.
 */
const ARM_TOOLTIP =
  'Armed means an AI can control connected machines; otherwise only humans may.';

/**
 * The one place a person says whether an AI may move the machine.
 *
 * This is the whole of the safety story made visible. Everything an agent can
 * do that moves an axis is refused until this is armed, and arming is
 * deliberately not something the agent can do for itself — it can ask, which
 * raises this to its attention state, and that is all.
 *
 * The label is ARM rather than anything about locking. "Locked" already means
 * something exact on these machines — GRBL's alarm lockout, cleared with `$X` —
 * and a navbar chip claiming the machine was locked when it was merely
 * unattended would be read as a fault to clear.
 *
 * The colour tracks the CURRENT STATE, not the action the button performs:
 * green while only people can move the machine, red while an AI can. This sits
 * in the navbar for the whole session, so it is read as a status lamp far more
 * often than it is clicked — and on a status lamp red means live. Colouring it
 * by the action instead put a red chip on screen while nothing was armed, which
 * is the safe state announcing itself as the dangerous one.
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
          AI asked to <strong>{arming.requestedFor?.replace(/_/g, ' ')}</strong>
        </span>
        <button
          onClick={() => machineArming.arm()}
          className="shrink-0 cursor-pointer rounded-md bg-amber-500 px-2 py-1 font-semibold tracking-wide text-white transition hover:bg-amber-400"
          title={ARM_TOOLTIP}
        >
          ARM
        </button>
      </div>
    );
  }

  if (!arming.armed) {
    return (
      <button
        onClick={() => machineArming.arm()}
        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold tracking-wide text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-400"
        title={ARM_TOOLTIP}
      >
        <ShieldCheck size={14} />
        ARM
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
      className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg border border-red-500/60 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300"
      title={`${ARM_TOOLTIP} Armed for another ${minutesLeft} minutes; disarming is immediate and cancels anything running.`}
    >
      <Bot size={14} className="shrink-0 animate-pulse" />
      <span className="shrink-0 font-semibold tracking-wide">ARMED</span>
      {showLast && (
        <span className="hidden truncate font-mono text-red-600 md:inline dark:text-red-300/90">
          {last!.name.replace(/_/g, ' ')}
          {last!.detail ? ` ${last!.detail}` : ''}
        </span>
      )}
      <span className="shrink-0 text-red-600/70 dark:text-red-300/60">{minutesLeft}m</span>
      <button
        onClick={() => machineArming.disarm('operator')}
        className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-red-600 px-2 py-1 font-semibold tracking-wide text-white transition hover:bg-red-500"
      >
        <Hand size={12} />
        DISARM
      </button>
    </div>
  );
}
