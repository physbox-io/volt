import { useEffect, useState } from 'react';
import { Bot, Hand, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { ArmingState } from '@physbox-io/machining';
import { machineArming, subscribeToArming } from '../utils/machineMcp';
import { webSerialManager } from '../utils/webSerialManager';

/**
 * The one place a person says whether Claude may move the machine.
 *
 * This is the whole of the safety story made visible. Everything an agent can
 * do that moves an axis is refused until this is armed, and arming is
 * deliberately not something the agent can do for itself — it can ask, which
 * raises the banner's attention state, and that is all.
 *
 * It is a banner rather than a setting in a dialog because it has to be true
 * that nobody arms this without noticing: while the window is open the banner
 * stays on screen, naming the last thing the agent did, with the way to close
 * it one click away. A checkbox buried in preferences would be armed once and
 * forgotten, which is the failure this is built to avoid.
 */
export function AgentMachineBanner() {
  const [arming, setArming] = useState<ArmingState>(() => machineArming.getState());
  const [connected, setConnected] = useState(() => webSerialManager.getState().connected);
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeToArming(setArming), []);
  useEffect(() => webSerialManager.addListener(s => setConnected(s.connected)), []);

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

  // Most people never plug a machine in, and a standing notice about something
  // that cannot happen to them is noise. It appears when there is a machine to
  // move, when the window is open, or when the agent has just asked.
  if (!connected && !arming.armed && !asked) return null;

  if (!arming.armed && !asked) {
    return (
      <button
        onClick={() => machineArming.arm()}
        className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
        title="Claude cannot move the machine until you allow it"
      >
        <ShieldCheck size={14} />
        Claude cannot move the machine
      </button>
    );
  }

  if (asked) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
        <ShieldAlert size={14} className="shrink-0" />
        <span>
          Claude asked to <strong>{arming.requestedFor?.replace(/_/g, ' ')}</strong> and was
          refused — it cannot move the machine until you allow it.
        </span>
        <button
          onClick={() => machineArming.arm()}
          className="shrink-0 rounded-md bg-amber-400 px-2 py-1 font-medium text-amber-950 transition hover:bg-amber-300"
        >
          Allow Claude to move this machine
        </button>
      </div>
    );
  }

  const minutesLeft =
    arming.expiresAt !== undefined ? Math.max(0, Math.ceil((arming.expiresAt - now) / 60_000)) : 0;
  const last = arming.lastAgentCommand;
  // Only while it is fresh: a command from twenty minutes ago is history, not a
  // description of what the machine is doing now.
  const showLast = last && now - last.at < 30_000;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
      <Bot size={14} className="shrink-0 animate-pulse" />
      <span className="shrink-0 font-medium">Claude can move this machine</span>
      {showLast ? (
        <span className="truncate font-mono text-emerald-300/90">
          {last!.name.replace(/_/g, ' ')}
          {last!.detail ? ` ${last!.detail}` : ''}
        </span>
      ) : (
        <span className="text-emerald-300/60">idle</span>
      )}
      <span className="ml-auto shrink-0 text-emerald-300/60">{minutesLeft}m left</span>
      <button
        onClick={() => machineArming.disarm('operator')}
        className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-400 px-2 py-1 font-medium text-emerald-950 transition hover:bg-emerald-300"
        title="Stops anything Claude is running and takes the permission back"
      >
        <Hand size={12} />
        Stop
      </button>
    </div>
  );
}
