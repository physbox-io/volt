import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { X, History, RefreshCw, AlertTriangle, Star, ChevronRight, ChevronDown } from 'lucide-react';
import {
  fetchRun,
  fetchRuns,
  isProAccount,
  isProRequired,
  getStoredAuthToken,
  type ArchivedRun,
  type RunSample,
} from '../utils/apiClient';

/**
 * What this machine has already cut.
 *
 * `RemoteMachiningModal` is the live view — one row per machine, refreshed every
 * few seconds, showing what is happening right now. It is unchanged and stays
 * available to every signed-in account. This is the other half: what happened
 * before, which nothing has ever kept, because the live row is upserted in place
 * and every finished job was overwritten by the next one.
 *
 * The archive is part of PhysBox Pro. A free account is not shown an error here —
 * it is shown what would have been recorded, which is a more honest answer than a
 * permission denial and a more useful one than an empty list.
 */

const APP_ID = 'circuit';

const APP_LABELS: Record<string, string> = {
  etch: 'Etch',
  physics: 'Mesh',
  circuit: 'Volt',
  process: 'Flux',
};

const PAGE_SIZE = 25;

interface JobHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Durations people read: 4h 12m, 12m 30s, 45s. */
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The material a run was cut from, dug out of whatever the app recorded.
 *
 * `settings` has no schema across the apps — each writes what it knows — so this
 * looks for the usual names and gives up quietly rather than confidently showing
 * the wrong thing.
 */
function materialOf(run: ArchivedRun): string {
  const s = run.settings;
  if (!s) return '';
  const value = s.material ?? s.stock ?? s.stockMaterial;
  return typeof value === 'string' ? value : '';
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  error: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
  cancelled: 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300',
  running: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
};

const StatusPill: React.FC<{ status: string }> = ({ status }) => (
  <span
    className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
      STATUS_STYLES[status] ?? STATUS_STYLES.cancelled
    }`}
  >
    {status}
  </span>
);

/**
 * The trace, as a plain inline SVG.
 *
 * A charting library for two polylines would outweigh this whole component, and
 * the shape of a cut — did the feed collapse, how far did it get before it stopped
 * — is legible at this size without axes or ticks.
 */
const Trace: React.FC<{ samples: RunSample[] }> = ({ samples }) => {
  const paths = useMemo(() => {
    if (samples.length < 2) return null;
    const maxT = Math.max(...samples.map((s) => s.tMs)) || 1;
    const maxFeed = Math.max(...samples.map((s) => s.feedRate || 0)) || 1;
    const progress: string[] = [];
    const feed: string[] = [];
    for (const s of samples) {
      const x = (s.tMs / maxT) * 600;
      progress.push(`${x},${140 - (Math.min(100, s.progressPercent || 0) / 100) * 130}`);
      feed.push(`${x},${140 - ((s.feedRate || 0) / maxFeed) * 130}`);
    }
    return { progress: progress.join(' '), feed: feed.join(' ') };
  }, [samples]);

  if (!paths) return null;

  return (
    <svg
      viewBox="0 0 600 140"
      preserveAspectRatio="none"
      className="w-full h-24 mt-3"
      role="img"
      aria-label="Progress and feed rate over the life of the run"
    >
      <polyline
        points={paths.feed}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        className="text-slate-400 dark:text-slate-600"
      />
      <polyline
        points={paths.progress}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        className="text-emerald-500 dark:text-emerald-400"
      />
    </svg>
  );
};

const RunDetail: React.FC<{ run: ArchivedRun; samples: RunSample[] }> = ({ run, samples }) => (
  <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/40 text-xs">
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
      <div>
        <dt className="uppercase tracking-wide text-[10px] font-bold text-slate-400">Started</dt>
        <dd>{formatWhen(run.startedAt)}</dd>
      </div>
      <div>
        <dt className="uppercase tracking-wide text-[10px] font-bold text-slate-400">Ended</dt>
        <dd>{run.endedAt ? formatWhen(run.endedAt) : 'still running'}</dd>
      </div>
      <div>
        <dt className="uppercase tracking-wide text-[10px] font-bold text-slate-400">Progress</dt>
        <dd>{Math.round(run.progressPercent || 0)}%</dd>
      </div>
      <div>
        <dt className="uppercase tracking-wide text-[10px] font-bold text-slate-400">Lines</dt>
        <dd>{run.totalLines ? `${run.linesCompleted} of ${run.totalLines}` : '—'}</dd>
      </div>
    </dl>

    {run.lastError && (
      <p className="mt-3 flex items-start gap-1.5 text-rose-600 dark:text-rose-400">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span className="break-all">{run.lastError}</span>
      </p>
    )}

    {run.settings && (
      <pre className="mt-3 p-2.5 max-h-48 overflow-auto rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px]">
        {JSON.stringify(run.settings, null, 2)}
      </pre>
    )}

    <Trace samples={samples} />
    {samples.length > 1 && (
      <p className="mt-1 text-[11px] text-slate-400">
        Progress in colour, feed rate in grey, over {formatDuration(run.durationSeconds)}.
      </p>
    )}
  </div>
);

export const JobHistoryModal: React.FC<JobHistoryModalProps> = ({ isOpen, onClose }) => {
  const [runs, setRuns] = useState<ArchivedRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  /** Set when the API actually refuses — the authority, as opposed to the hint. */
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [everyApp, setEveryApp] = useState(false);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [openId, setOpenId] = useState<string | null>(null);
  const [samples, setSamples] = useState<RunSample[]>([]);

  const signedIn = Boolean(getStoredAuthToken());
  /*
   * The stored profile is a hint and the 403 is the authority, so this is the two
   * of them together — and it is derived rather than held in state, because it is
   * not a fact about this component, it is a fact about the account.
   */
  const isPro = isProAccount();
  const needsPro = refused || !isPro;

  // Debounced: a search box that queried per keystroke would hit the archive eight
  // times on the way to typing "walnut".
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (before?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchRuns({
          appId: everyApp ? undefined : APP_ID,
          status: status || undefined,
          q: debouncedSearch || undefined,
          limit: PAGE_SIZE,
          before,
        });
        setRuns((prev) => (before ? [...prev, ...res.runs] : res.runs));
        setNextBefore(res.nextBefore);
        setRefused(false);
        // A fresh list, so nothing that was expanded still applies to a row in it.
        if (!before) {
          setOpenId(null);
          setSamples([]);
        }
      } catch (err) {
        if (isProRequired(err)) {
          setRefused(true);
        } else {
          setError(err instanceof Error ? err.message : 'Could not load history.');
        }
      } finally {
        setLoading(false);
      }
    },
    [everyApp, status, debouncedSearch]
  );

  useEffect(() => {
    if (!isOpen || !signedIn) return;
    // Not even asked for a free account: the point of this feature is that nothing
    // about the free app changes, and a console full of handled 403s is a change.
    if (!isPro) return;
    // The rule sees a setState reachable from an effect body — `load` raises its
    // spinner before it awaits. This is fetching from an external system when the
    // modal opens, not state derived during render, and it is the same exception
    // UserProfileButton documents for the same reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [isOpen, signedIn, isPro, load]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const toggleRun = async (run: ArchivedRun) => {
    if (openId === run.id) {
      setOpenId(null);
      return;
    }
    // Opened immediately from what the list already holds — the settings are what
    // people came for and should not wait on a second request — then the trace
    // fills in behind it.
    setOpenId(run.id);
    setSamples([]);
    try {
      const detail = await fetchRun(run.id);
      setSamples(detail.samples || []);
    } catch {
      /* the summary is already on screen */
    }
  };

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[99999] bg-slate-900/50 dark:bg-black/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl my-auto overflow-hidden text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">Job History</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Every run this account has recorded, and what it was cut at
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!needsPro && signedIn && (
              <button
                onClick={() => void load()}
                disabled={loading}
                className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!signedIn ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Sign in to see the jobs this account has run.
          </div>
        ) : needsPro ? (
          /* Not an error page. What Pro would have recorded, in the terms somebody
             deciding whether they want it would actually weigh. */
          <div className="px-6 py-8 text-sm">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold mb-3">
              <Star className="w-4 h-4" />
              <span>Job history is part of PhysBox Pro</span>
            </div>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Everything you use today keeps working exactly as it does now — the engines, machine
              control, local saves and live remote monitoring. Nothing is being taken away.
            </p>
            <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
              What Pro adds is memory. Every job is archived as it runs: how long it took, how far it
              got, the feed and spindle trace, the line an alarm stopped it on, and the material and
              power it was cut at. Then it is readable here, on physbox.io, and by your own AI agent —
              so <em>“what did I cut that walnut at in March”</em> has an answer.
            </p>
            <a
              href="https://physbox.io/pro.html"
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs"
            >
              See PhysBox Pro
            </a>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={everyApp}
                  onChange={(e) => setEveryApp(e.target.checked)}
                  className="cursor-pointer"
                />
                <span>Every app</span>
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer"
                aria-label="Filter by outcome"
              >
                <option value="">Any outcome</option>
                <option value="completed">Completed</option>
                <option value="error">Error</option>
                <option value="cancelled">Cancelled</option>
                <option value="running">Running</option>
              </select>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search job, document or material…"
                aria-label="Search runs"
                className="flex-1 min-w-[10rem] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div className="overflow-y-auto grow">
              {error && (
                <p className="px-6 py-4 text-xs text-rose-600 dark:text-rose-400">{error}</p>
              )}

              {!error && runs.length === 0 && !loading && (
                <p className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Nothing archived yet. A run appears here within seconds of a job starting.
                </p>
              )}

              {runs.map((run) => (
                <div key={run.id} className="border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                  <button
                    onClick={() => void toggleRun(run)}
                    aria-expanded={openId === run.id}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 transition cursor-pointer"
                  >
                    {openId === run.id ? (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    )}
                    <span className="w-28 shrink-0 text-slate-500 dark:text-slate-400">
                      {formatWhen(run.startedAt)}
                    </span>
                    <span className="grow min-w-0 truncate font-medium">
                      {run.jobName || '—'}
                      {everyApp && (
                        <span className="ml-2 text-slate-400">{APP_LABELS[run.appId] ?? run.appId}</span>
                      )}
                    </span>
                    <span className="w-20 shrink-0 text-right text-slate-500 dark:text-slate-400">
                      {run.status === 'running' ? 'running' : formatDuration(run.durationSeconds)}
                    </span>
                    <span className="w-24 shrink-0 truncate text-slate-500 dark:text-slate-400">
                      {materialOf(run) || ''}
                    </span>
                    <span className="w-20 shrink-0 text-right">
                      <StatusPill status={run.status} />
                    </span>
                  </button>
                  {openId === run.id && <RunDetail run={run} samples={samples} />}
                </div>
              ))}

              {nextBefore && (
                <div className="p-4 text-center">
                  <button
                    onClick={() => void load(nextBefore)}
                    disabled={loading}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {loading ? 'Loading…' : 'Load older runs'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
