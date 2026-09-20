import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { PART_CATALOG, catalogKey, searchParts, type CatalogPart } from './nodes/partCatalog';

/**
 * Type-to-place: the palette without the drag.
 *
 * Opened with `/` or Shift+A, it places the part the same way a tap in the
 * palette does — in the middle of what the operator is looking at — so a run of
 * parts can be laid down without the cursor leaving the canvas.
 */
export function QuickAddPalette({
  onPick,
  onClose,
}: {
  onPick: (type: string, label?: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchParts(query, PART_CATALOG), [query]);
  const active = results[Math.min(cursor, results.length - 1)];

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Keep the highlighted row on screen when the arrows walk past the fold.
  useEffect(() => {
    const row = listRef.current?.querySelector('[data-active="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [cursor, results]);

  const place = (part: CatalogPart | undefined) => {
    if (!part) return;
    onPick(part.type, part.label);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-start justify-center pt-[12vh] bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150"
      onMouseDown={onClose}
    >
      <div
        className="w-[min(480px,92vw)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <Search size={16} className="text-slate-400 dark:text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => {
              // The highlight goes back to the best match as the query changes,
              // set here rather than from an effect on `query`, which would be a
              // second render for every keystroke.
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor(c => Math.min(c + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor(c => Math.max(c - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                place(active);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Add a part — resistor, 555, +5V rail…"
            className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Nothing matches “{query}”.
            </p>
          )}
          {results.map((part, i) => (
            <button
              key={catalogKey(part)}
              type="button"
              data-active={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => place(part)}
              className={`w-full flex items-baseline gap-2 px-4 py-1.5 text-left transition-colors ${
                i === cursor
                  ? 'bg-emerald-50 dark:bg-emerald-950/40'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <span className="text-sm text-slate-800 dark:text-slate-100">{part.name}</span>
              {part.label && (
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{part.label}</span>
              )}
              <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {part.section}
              </span>
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
          ↑↓ to choose · Enter to place at the centre of the view
        </div>
      </div>
    </div>
  );
}
