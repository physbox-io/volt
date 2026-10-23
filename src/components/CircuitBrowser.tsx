import { useEffect, useState } from 'react';
import { Search, X, FilePlus2, FolderOpen, BookOpen, FileJson, Clock, Cpu, Pencil, Copy, Trash2, Check, HardDrive } from 'lucide-react';
import { EXAMPLE_SHELVES, exampleEntries, matchesQuery, formatSceneDate, type ExampleEntry } from '../utils/circuitCatalog';
import { listRecent, RECENT_CHANGED_EVENT, type CircuitBrowserTab } from '../utils/recentCircuits';
import { userPresetName, type CircuitPreset, type PresetFileResult } from '../utils/storage';

const EXAMPLES = exampleEntries();

interface SavedCircuit {
  key: string;
  name: string;
  savedAt: number | null;
  thumbnail: string | null;
  bytes: number;
}

type SavedSort = 'date' | 'name';

function savedCircuits(userPresets: Record<string, CircuitPreset>, sort: SavedSort): SavedCircuit[] {
  const byName = (a: SavedCircuit, b: SavedCircuit) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  return Object.entries(userPresets)
    .map(([key, p]) => {
      let bytes = 0;
      try { bytes = JSON.stringify(p).length; } catch { /* unknown, then */ }
      return {
        key,
        name: userPresetName(p),
        savedAt: typeof p.savedAt === 'number' ? p.savedAt : null,
        thumbnail: typeof p.thumbnail === 'string' ? p.thumbnail : null,
        bytes,
      };
    })
    // Newest first, and the undated (saved before dates were kept) after, by name.
    .sort(sort === 'name' ? byName : (a, b) => (b.savedAt ?? -1) - (a.savedAt ?? -1) || byName(a, b));
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** One thing opened lately, resolved to what it is. */
type RecentItem =
  | { kind: 'saved'; id: string; name: string; thumbnail: string | null; at: number }
  | { kind: 'example'; id: string; entry: ExampleEntry; at: number };

/** The recents that still exist. */
function recentItems(saved: SavedCircuit[]): RecentItem[] {
  const byKey = new Map(saved.map((s) => [s.key, s]));
  return listRecent().flatMap((r): RecentItem[] => {
    const s = byKey.get(r.id);
    if (s) return [{ kind: 'saved', id: r.id, name: s.name, thumbnail: s.thumbnail, at: r.at }];
    const entry = EXAMPLES.find((e) => e.id === r.id);
    return entry ? [{ kind: 'example', id: r.id, entry, at: r.at }] : [];
  });
}

interface CircuitBrowserProps {
  tab: CircuitBrowserTab | null;
  onTab: (tab: CircuitBrowserTab) => void;
  onClose: () => void;
  userPresets: Record<string, CircuitPreset>;
  selectedPreset: string;
  onLoad: (key: string) => void;
  onRename: (key: string, to: string) => PresetFileResult;
  onDuplicate: (key: string) => PresetFileResult;
  onDelete: (key: string) => void;
  onImportJson: () => void;
}

/**
 * The circuit browser: the user's saved circuits and the built-in examples,
 * with one search over both. It replaces the header's <select>, which listed
 * forty-odd examples and every saved circuit in one column with no search.
 * The same browser as Mesh's scene browser, less the pattern boards.
 */
export function CircuitBrowser(props: CircuitBrowserProps) {
  // Mounted only while open, so each opening starts with an empty search.
  return props.tab ? <OpenCircuitBrowser {...props} tab={props.tab} /> : null;
}

function OpenCircuitBrowser({
  tab, onTab, onClose, userPresets, selectedPreset, onLoad, onRename, onDuplicate, onDelete, onImportJson,
}: CircuitBrowserProps & { tab: CircuitBrowserTab }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [query, setQuery] = useState('');
  // The recents are read on render; this asks for one after they change.
  const [, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(RECENT_CHANGED_EVENT, bump);
    return () => window.removeEventListener(RECENT_CHANGED_EVENT, bump);
  }, []);
  const [sort, setSort] = useState<SavedSort>('date');
  const saved = savedCircuits(userPresets, sort);
  const recent = recentItems(saved);

  const q = query.trim();
  const foundSaved = saved.filter((s) => matchesQuery(q, s.name));
  const foundExamples = EXAMPLES.filter((e) => matchesQuery(q, e.name, e.shelf));

  const load = (key: string) => { onClose(); onLoad(key); };

  const remove = (s: SavedCircuit) => {
    const open = s.key === selectedPreset;
    if (window.confirm(`Delete “${s.name}”?${open ? ' It is open now; the canvas goes back to the default circuit.' : ''}`)) onDelete(s.key);
  };

  /** Enter in the search box opens the first thing it found. */
  const openFirst = () => {
    if (foundSaved[0]) load(foundSaved[0].key);
    else if (foundExamples[0]) load(foundExamples[0].id);
  };

  const tabs: { id: CircuitBrowserTab; label: string; Icon: typeof FolderOpen; count: number }[] = [
    { id: 'recent', label: 'Recent', Icon: Clock, count: recent.length },
    { id: 'mine', label: 'My circuits', Icon: FolderOpen, count: foundSaved.length },
    { id: 'examples', label: 'Examples', Icon: BookOpen, count: foundExamples.length },
  ];

  const savedSection = foundSaved.length > 0 ? (
    <>
      {!q && foundSaved.length > 1 && (
        <div className="flex justify-end gap-1 mb-2 text-[10px]">
          <span className="text-slate-400 mr-1 self-center">Sort by</span>
          {(['date', 'name'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`px-2 py-0.5 rounded cursor-pointer ${sort === k
                ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-100'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              {k === 'date' ? 'Date' : 'Name'}
            </button>
          ))}
        </div>
      )}
      <SavedCircuitList
        circuits={foundSaved}
        activeKey={selectedPreset}
        onOpen={load}
        onRename={onRename}
        onDuplicate={(key) => {
          const result = onDuplicate(key);
          if (result.ok === false) window.alert(result.message);
        }}
        onDelete={remove}
      />
    </>
  ) : (
    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
      {q ? 'No saved circuit matches.' : 'Nothing saved yet. The disk icon in the toolbar saves the circuit on the canvas.'}
    </div>
  );

  const examplesSection = EXAMPLE_SHELVES.map((shelf) => {
    const onShelf = foundExamples.filter((e) => e.shelf === shelf);
    if (onShelf.length === 0) return null;
    return (
      <div key={shelf}>
        <SectionHeading>{shelf}</SectionHeading>
        <ExampleGrid entries={onShelf} activeId={selectedPreset} onOpen={load} />
      </div>
    );
  });

  const nothing = q && foundSaved.length + foundExamples.length === 0;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-5xl h-full sm:h-[85dvh] bg-white dark:bg-slate-900 sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
        {/* Search, and starting from nothing */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 focus-within:ring-2 ring-emerald-400">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') openFirst(); }}
              placeholder="Search circuits and examples"
              className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
              aria-label="Search circuits"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600 cursor-pointer" title="Clear">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => load('empty')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shrink-0"
            title="Start an empty canvas"
          >
            <FilePlus2 className="w-4 h-4" />
            <span className="hidden sm:inline">New blank</span>
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" title="Close (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex min-h-0 max-sm:flex-col">
          {/* Where to look. A column at desktop width, a strip of pills on a phone. */}
          <nav className="sm:w-48 shrink-0 sm:border-r border-b sm:border-b-0 border-slate-200 dark:border-slate-800 p-2 flex sm:flex-col gap-1 overflow-x-auto">
            {tabs.map(({ id, label, Icon, count }) => {
              const on = !q && tab === id;
              return (
                <button
                  key={id}
                  onClick={() => { setQuery(''); onTab(id); }}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${
                    on
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-left">{label}</span>
                  <span className="text-[10px] text-slate-400 tabular-nums">{count}</span>
                </button>
              );
            })}
            <div className="hidden sm:block flex-1" />
            <button
              onClick={() => { onClose(); onImportJson(); }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
              title="Open a circuit saved as a .json file"
            >
              <FileJson className="w-4 h-4 shrink-0" />
              <span>Open file…</span>
            </button>
          </nav>

          <div className="flex-1 overflow-y-auto p-4">
            {nothing ? (
              <div className="h-full flex flex-col items-center justify-center text-sm text-slate-400 gap-2">
                <Cpu className="w-8 h-8" />
                Nothing matches “{q}”.
              </div>
            ) : q ? (
              <>
                {foundSaved.length > 0 && <><SectionHeading>My circuits</SectionHeading>{savedSection}</>}
                {foundExamples.length > 0 && examplesSection}
              </>
            ) : tab === 'recent' ? (
              recent.length > 0 ? (
                <RecentGrid items={recent} activeId={selectedPreset} onOpen={load} />
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  Circuits you open show up here.
                </div>
              )
            ) : tab === 'mine' ? savedSection : examplesSection}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-5 mb-2 first:mt-0">
      {children}
    </h3>
  );
}

/** A saved circuit's picture from its last save, or `fallback` for one saved before they were kept. */
function CircuitThumb({ url, fallback, className }: { url: string | null; fallback: React.ReactNode; className: string }) {
  return (
    <div className={`overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center ${className}`}>
      {url ? <img src={url} alt="" className="w-full h-full object-cover" draggable={false} /> : fallback}
    </div>
  );
}

const GRID = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2';

function ExampleGrid({ entries, activeId, onOpen }: { entries: ExampleEntry[]; activeId: string; onOpen: (id: string) => void }) {
  return (
    <div className={GRID}>
      {entries.map((e) => (
        <button
          key={e.id}
          onClick={() => onOpen(e.id)}
          className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md ${
            e.id === activeId
              ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
          title={e.id === activeId ? 'Open now. Click to start it again.' : `Open ${e.name}`}
        >
          <span className="text-2xl leading-none shrink-0" aria-hidden>{e.emoji}</span>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-snug line-clamp-2">{e.name}</span>
        </button>
      ))}
    </div>
  );
}

/** The recents, as picture cards: a saved circuit's last save, an example's emoji. */
function RecentGrid({ items, activeId, onOpen }: { items: RecentItem[]; activeId: string; onOpen: (id: string) => void }) {
  return (
    <div className={GRID}>
      {items.map((item) => {
        const label = item.kind === 'saved' ? item.name : item.entry.name;
        return (
          <button
            key={item.id}
            onClick={() => onOpen(item.id)}
            className={`flex flex-col gap-1.5 p-1.5 rounded-lg border text-left cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md ${
              item.id === activeId
                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
            title={`Open ${label}`}
          >
            {item.kind === 'saved' ? (
              <CircuitThumb url={item.thumbnail} className="aspect-[4/3] w-full rounded-md" fallback={<span className="text-3xl" aria-hidden>💾</span>} />
            ) : (
              <div className="aspect-[4/3] w-full rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-4xl" aria-hidden>
                {item.entry.emoji}
              </div>
            )}
            <span className="px-1 text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{label}</span>
            <span className="px-1 pb-0.5 text-[10px] text-slate-400 dark:text-slate-500">
              {item.kind === 'saved' ? 'Saved circuit' : 'Example'} · {formatSceneDate(item.at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The user's saved circuits as rows: click to open, and rename, copy or delete
 * from the buttons that show on hover (always, on a touch screen).
 */
function SavedCircuitList({
  circuits, activeKey, onOpen, onRename, onDuplicate, onDelete,
}: {
  circuits: SavedCircuit[];
  activeKey: string;
  onOpen: (key: string) => void;
  onRename: (key: string, to: string) => PresetFileResult;
  onDuplicate: (key: string) => void;
  onDelete: (circuit: SavedCircuit) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const commitRename = () => {
    if (!renaming) return;
    const result = onRename(renaming, draft);
    if (result.ok === false) setRenameError(result.message);
    else { setRenaming(null); setRenameError(null); }
  };

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
      {circuits.map((s) => {
        const active = s.key === activeKey;
        const editing = renaming === s.key;
        return (
          <li
            key={s.key}
            className={`group flex items-center gap-3 px-3 py-2 ${active ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
          >
            <CircuitThumb url={s.thumbnail} className="w-16 h-12 rounded shrink-0" fallback={<HardDrive className="w-4 h-4 text-slate-400" />} />

            {editing ? (
              <form
                className="flex-1 min-w-0"
                onSubmit={(e) => { e.preventDefault(); commitRename(); }}
              >
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value); setRenameError(null); }}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(null); } }}
                    className="flex-1 min-w-0 text-sm px-2 py-1 rounded border border-emerald-400 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none"
                    aria-label="New name"
                  />
                  <button type="submit" className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer" title="Rename">
                    <Check className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className="p-1 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" title="Cancel">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {renameError && <p className="mt-1 text-[10px] text-red-500">{renameError}</p>}
              </form>
            ) : (
              <button
                onClick={() => onOpen(s.key)}
                className="flex-1 min-w-0 text-left cursor-pointer"
                title={active ? 'Open now. Click to reload the saved copy.' : `Open “${s.name}”`}
              >
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{s.name}</span>
                <span className="block text-[10px] text-slate-400">
                  {[active ? 'Open now' : null, s.savedAt != null ? formatSceneDate(s.savedAt) : null, formatBytes(s.bytes)]
                    .filter(Boolean).join(' · ')}
                </span>
              </button>
            )}

            {!editing && (
              <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                <button
                  onClick={() => { setRenaming(s.key); setDraft(s.name); setRenameError(null); }}
                  className="p-1.5 rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                  title="Rename"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDuplicate(s.key)}
                  className="p-1.5 rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                  title="Make a copy"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(s)}
                  className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
