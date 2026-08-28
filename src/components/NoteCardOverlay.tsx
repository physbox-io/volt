import { useRef } from 'react';
import { FileText, Edit3, ChevronDown, ChevronUp, X } from 'lucide-react';

// Simple robust markdown parser to convert basic markdown text to safe HTML
function parseNoteMarkdown(md: string): string {
  if (!md) return '';
  let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/^### (.*$)/gim, '<h3 class="text-xs font-bold text-slate-800 dark:text-slate-200 mt-2 mb-1 uppercase tracking-wide">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="text-sm font-bold text-slate-800 dark:text-slate-200 mt-3 mb-1 border-b border-slate-100 dark:border-slate-800 pb-0.5">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="text-base font-extrabold text-slate-900 dark:text-slate-100 mt-3 mb-2 border-b border-slate-200 dark:border-slate-800 pb-1">$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-slate-100">$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em class="italic text-slate-700 dark:text-slate-300">$1</em>');
  html = html.replace(/`(.*?)`/g, '<code class="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-mono text-pink-600 dark:text-pink-400">$1</code>');
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-emerald-600 dark:text-emerald-400 hover:underline">$1</a>');
  html = html.replace(/^\s*-\s+(.*$)/gim, '<li class="ml-4 list-disc text-slate-650 dark:text-slate-300 text-xs mb-0.5">$1</li>');
  html = html.split('\n').map(line => {
    const t = line.trim();
    if (t.startsWith('<h') || t.startsWith('<li') || t === '') return line;
    return `<p class="text-xs text-slate-600 dark:text-slate-300 mb-1.5 leading-relaxed">${line}</p>`;
  }).join('\n');
  return html;
}

// Floating note card overlay component
export function NoteCardOverlay({ card, isEditing, onToggleEdit, onToggleMinimize, onMarkdownChange, onClose, onMove }: {
  card: { id: string; markdown: string; minimized: boolean; x: number; y: number };
  isEditing: boolean;
  onToggleEdit: () => void;
  onToggleMinimize: () => void;
  onMarkdownChange: (md: string) => void;
  onClose: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Pointer, not mouse, events: a finger and a stylus then move the card by the
  // same code path as a cursor. A mouse drag behaves exactly as it did.
  const handleTitleMouseDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: card.x, origY: card.y };
    const handleMouseMove = (me: PointerEvent) => {
      if (!dragRef.current) return;
      onMove(dragRef.current.origX + me.clientX - dragRef.current.startX, dragRef.current.origY + me.clientY - dragRef.current.startY);
    };
    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', handleMouseMove);
      window.removeEventListener('pointerup', handleMouseUp);
      window.removeEventListener('pointercancel', handleMouseUp);
    };
    window.addEventListener('pointermove', handleMouseMove);
    window.addEventListener('pointerup', handleMouseUp);
    window.addEventListener('pointercancel', handleMouseUp);
  };

  return (
    <div
      data-note-card
      // `maxWidth` so the card cannot hang off the side of a phone, where its
      // close button would be the part that went over the edge.
      style={{ position: 'absolute', left: card.x, top: card.y, width: 300, maxWidth: 'calc(100vw - 24px)' }}
      /*
        The stacking order is a class, not the inline `zIndex` it used to be,
        so that it can differ by width. On a desktop the card floats in a corner
        of the canvas and nothing else wants that space. On a phone every panel
        and modal is full-width, and a card pinned above them covered the thing
        the user had just opened — so below `lg` it drops beneath them while
        staying above the canvas it annotates.
      */
      className="z-[100] max-lg:z-[45] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl overflow-hidden"
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-slate-50/80 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800 cursor-move select-none"
        onPointerDown={handleTitleMouseDown}
      >
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Note Card</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onToggleEdit} className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors" title={isEditing ? 'Preview' : 'Edit'}>
            <Edit3 className="w-3 h-3 text-slate-500 dark:text-slate-400" />
          </button>
          <button onClick={onToggleMinimize} className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors" title={card.minimized ? 'Expand' : 'Minimize'}>
            {card.minimized ? <ChevronDown className="w-3 h-3 text-slate-500 dark:text-slate-400" /> : <ChevronUp className="w-3 h-3 text-slate-500 dark:text-slate-400" />}
          </button>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors" title="Close">
            <X className="w-3 h-3 text-slate-500 dark:text-slate-400 hover:text-red-500" />
          </button>
        </div>
      </div>

      {/* Body */}
      {!card.minimized && (
        <div className="p-3">
          {isEditing ? (
            <textarea
              autoFocus
              rows={8}
              value={card.markdown}
              onChange={(e) => onMarkdownChange(e.target.value)}
              className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded text-xs bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 outline-none focus:border-violet-400 font-mono resize-y shadow-sm"
              placeholder="Write markdown here..."
            />
          ) : (
            <div
              className="prose-sm dark:prose-invert max-h-64 overflow-y-auto text-slate-700 dark:text-slate-300 font-normal text-slate-650 dark:text-slate-400 leading-normal"
              dangerouslySetInnerHTML={{ __html: parseNoteMarkdown(card.markdown) }}
            />
          )}
        </div>
      )}
    </div>
  );
}
