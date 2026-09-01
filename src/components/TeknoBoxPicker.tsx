import React, { useCallback, useEffect, useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import {
  claimMachineDevice,
  fetchMachineDevices,
  getStoredAuthToken,
  type MachineDevice,
} from '../utils/apiClient';

/**
 * Choosing a Tekno Box, and claiming one that has not been claimed yet.
 *
 * ---------------------------------------------------------------------------
 * This file is duplicated in mesh, etch and volt, and is meant to be.
 *
 * There is no shared package between the three apps — `apiClient.ts` and
 * `grblTransport.ts` are copied the same way — so the choice here was between
 * one file kept identical in three places, or three different pairing flows
 * that drift. Pairing is the first thing a customer ever does with the hardware
 * and the easiest thing to get subtly wrong in one app and not another, so it
 * is the last thing that should be written three times.
 *
 * Edit it in one app and copy it to the other two.
 * ---------------------------------------------------------------------------
 *
 * Every app carries the whole flow, not just the picker. Somebody may only ever
 * open Etch: telling them to go and install a different app to claim the box on
 * their own bench is not an answer, it is a dead end.
 */
export const TeknoBoxPicker: React.FC<{
  /** Currently selected device id, or '' for none. */
  value: string;
  onChange: (deviceId: string, name?: string) => void;
  /** Locked while a machine is connected — swapping under a live link is nonsense. */
  disabled?: boolean;
  /**
   * Tailwind classes for the primary action, so this sits in each app's palette
   * without carrying a theme of its own.
   */
  accentClass?: string;
}> = ({ value, onChange, disabled = false, accentClass = 'bg-blue-500 hover:bg-blue-600 text-slate-950' }) => {
  const [devices, setDevices] = useState<MachineDevice[]>([]);
  const [pairCode, setPairCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const signedIn = Boolean(getStoredAuthToken());

  /**
   * Picks a sensible machine rather than leaving somebody to choose from a list
   * of one: whatever is already selected if it still exists, else something
   * that is actually switched on, else the first.
   */
  const settle = useCallback(
    (list: MachineDevice[], current: string) => {
      const keep = current && list.some((d) => d.deviceId === current);
      const chosen = keep ? current : list.find((d) => d.online)?.deviceId ?? list[0]?.deviceId ?? '';
      if (chosen !== current) {
        onChange(chosen, list.find((d) => d.deviceId === chosen)?.name);
      }
      return chosen;
    },
    [onChange]
  );

  const load = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true);
    try {
      const list = await fetchMachineDevices();
      setDevices(list);
      settle(list, value);
    } finally {
      setLoading(false);
    }
    // `value` is deliberately not a dependency: this reads it to decide whether
    // the current pick survives, and depending on it would reload the list
    // every time the selection changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, settle]);

  /*
   * Load once on mount, discarding a reply that arrives after unmount —
   * otherwise a slow response sets state on a panel that has closed.
   */
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void fetchMachineDevices().then((list) => {
      if (!live) return;
      setDevices(list);
      settle(list, value);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  const handlePair = async () => {
    const code = pairCode.trim().toUpperCase();
    if (!code) return;
    setPairing(true);
    setError(null);
    try {
      const { deviceId } = await claimMachineDevice(code);
      setPairCode('');
      const list = await fetchMachineDevices();
      setDevices(list);
      onChange(deviceId, list.find((d) => d.deviceId === deviceId)?.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not pair that machine.');
    } finally {
      setPairing(false);
    }
  };

  if (!signedIn) {
    return (
      <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
        Sign in to reach a Tekno Box over the internet — the connection is made through your
        account, which is what stops it being anyone else's machine.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {devices.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={value}
            disabled={disabled}
            onChange={(e) =>
              onChange(e.target.value, devices.find((d) => d.deviceId === e.target.value)?.name)
            }
            className="flex-1 min-w-[11rem] px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-40 cursor-pointer"
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.name} {d.online ? '— online' : '— offline'}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title="Check again which machines are online"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          No Tekno Box paired to this account yet.
        </p>
      )}

      {/* Where the code comes from, said at the point of asking for it. Nobody
          discovers a screen two taps into a second menu page by guessing. */}
      <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
        <strong>On the Tekno Box:</strong> tap through to page 2 of the menu, open{' '}
        <strong>MACHINE CTRL</strong>, and it shows a six-character code. Type that in here.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="w-3.5 h-3.5 text-slate-400" />
        <input
          value={pairCode}
          onChange={(e) => setPairCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handlePair();
          }}
          placeholder="Code from MACHINE CTRL"
          maxLength={8}
          spellCheck={false}
          aria-label="Pairing code"
          className="flex-1 min-w-[10rem] px-2 py-1 text-xs font-mono tracking-widest uppercase rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={() => void handlePair()}
          disabled={!pairCode.trim() || pairing}
          className={`px-3 py-1 rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer ${accentClass}`}
        >
          {pairing ? 'Pairing…' : 'Pair'}
        </button>
      </div>

      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}

      <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
        The machine connects out to physbox itself, so this works from anywhere and needs nothing
        opened on your router. A job sent this way is cut by the machine on its own — you can close
        this page and the cut carries on.
      </p>
    </div>
  );
};
