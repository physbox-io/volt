import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert, CircleAlert, Info, X } from 'lucide-react';
import type { Advisory, AdvisorySeverity } from '../types/advisories';
import { countBySeverity, sortAdvisories } from '../types/advisories';

/**
 * The one place Volt says something is wrong.
 *
 * It is a count in the status bar and nothing else until it is asked. Three
 * things feed it — the rules check, the ratings check and a run that failed —
 * and none of them are allowed to interrupt: a warning that stops the work is
 * a warning that gets turned off, and then the one that mattered goes with it.
 *
 * The single exception is a run that produced no data at all. There is nothing
 * on the canvas to look at in that case and no other way to find out why, so an
 * error opens the list once, on arrival, and never again for the same error.
 */

const TONE: Record<AdvisorySeverity, { chip: string; row: string; Icon: typeof Info }> = {
  error: {
    chip: 'bg-red-600 border-red-700 text-white',
    row: 'text-red-600 dark:text-red-400',
    Icon: CircleAlert,
  },
  warning: {
    chip: 'bg-amber-100 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300',
    row: 'text-amber-600 dark:text-amber-400',
    Icon: TriangleAlert,
  },
  advisory: {
    chip: 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300',
    row: 'text-sky-600 dark:text-sky-400',
    Icon: Info,
  },
};

export function AdvisoryPanel({
  advisories,
  onSelectNode,
}: {
  advisories: Advisory[];
  /** Selects the part on the canvas and scrolls it into view. */
  onSelectNode?: (nodeId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  /*
   * A dismissal lasts as long as the thing it dismissed.
   *
   * Pruned during render rather than from an effect, so the list the panel
   * draws is never one render behind the advisories it was handed — and so
   * that fixing a circuit and then breaking it the same way again says so the
   * second time, instead of staying quiet about a warning nobody is still
   * looking at.
   */
  const liveIds = useMemo(() => advisories.map(a => a.id).join('|'), [advisories]);
  const [prunedFor, setPrunedFor] = useState(liveIds);
  if (prunedFor !== liveIds) {
    setPrunedFor(liveIds);
    const live = new Set(advisories.map(a => a.id));
    if ([...dismissed].some(id => !live.has(id))) {
      setDismissed(new Set([...dismissed].filter(id => live.has(id))));
    }
  }

  const visible = useMemo(
    () => sortAdvisories(advisories.filter(a => !dismissed.has(a.id))),
    [advisories, dismissed],
  );
  const counts = countBySeverity(visible);
  const worst: AdvisorySeverity = counts.errors > 0 ? 'error' : counts.warnings > 0 ? 'warning' : 'advisory';

  /*
   * The one case that opens itself.
   *
   * A run that produced nothing leaves the canvas exactly as it was, so there
   * is no other way to find out that it failed or why. Once per distinct
   * error — reopening it every render would make the panel impossible to close.
   */
  const firstErrorId = visible.find(a => a.severity === 'error')?.id ?? null;
  const [announced, setAnnounced] = useState<string | null>(null);
  if (firstErrorId && announced !== firstErrorId) {
    setAnnounced(firstErrorId);
    if (!isOpen) setIsOpen(true);
  }

  if (visible.length === 0) return null;

  const label = counts.errors > 0
    ? `${counts.errors} problem${counts.errors === 1 ? '' : 's'}`
    : counts.warnings > 0
      ? `${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`
      : `${counts.advisories} note${counts.advisories === 1 ? '' : 's'}`;

  const { Icon } = TONE[worst];

  return (
    <>
      <button
        onClick={() => setIsOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-colors cursor-pointer ${TONE[worst].chip}`}
        title="What Volt noticed about this circuit"
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </button>

      {/*
        Portalled to the body for the same reason the share panel is: the status
        bar is a stacking context of its own, so a z-index set inside it only
        ranks against its siblings and the panel would open underneath a note
        card.
      */}
      {isOpen &&
        createPortal(
          <div className="fixed bottom-12 left-3 max-lg:left-1/2 max-lg:-translate-x-1/2 z-[105] w-[30rem] max-w-[92vw] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Circuit checks</p>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer px-1"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <ul className="max-h-[50vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map(a => {
                const tone = TONE[a.severity];
                const RowIcon = tone.Icon;
                return (
                  <li key={a.id} className="flex items-start gap-2 px-3 py-2">
                    <RowIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tone.row}`} />
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => a.nodeId && onSelectNode?.(a.nodeId)}
                        disabled={!a.nodeId}
                        className={`text-left text-[11px] font-semibold text-slate-800 dark:text-slate-100 ${
                          a.nodeId ? 'hover:underline cursor-pointer' : 'cursor-default'
                        }`}
                      >
                        {a.title}
                      </button>
                      {a.detail && (
                        <p className="mt-0.5 text-[10px] leading-snug text-slate-500 dark:text-slate-400 whitespace-pre-line">
                          {a.detail}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setDismissed(prev => new Set(prev).add(a.id))}
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Hide this one until it comes back"
                    >
                      Hide
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
