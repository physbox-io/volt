import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface InfoTipProps {
  /** Tooltip body. Keep it to a sentence or two. */
  children: React.ReactNode;
  /** Visual size of the icon in px. */
  size?: number;
  className?: string;
}

/**
 * Small (i) affordance with a hover/focus tooltip.
 *
 * The tooltip is portalled to <body> and positioned in viewport coordinates:
 * most of the places these appear are inside scrolling, overflow-hidden panels
 * that would otherwise clip it.
 */
export function InfoTip({ children, size = 13, className = '' }: InfoTipProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flip below the icon when there is not enough room above it.
    const below = r.top < 140;
    setPos({
      left: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130),
      top: below ? r.bottom + 8 : r.top - 8,
      below,
    });
  };

  const hide = () => setPos(null);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="More information"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Tooltips are the whole point of this control; don't let a stray tap
        // inside a form submit or toggle anything.
        onClick={e => e.preventDefault()}
        className={`inline-flex items-center justify-center text-slate-500 hover:text-cyan-400 focus:text-cyan-400 transition-colors cursor-help align-middle ${className}`}
      >
        <Info style={{ width: size, height: size }} />
      </button>

      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              left: pos.left,
              top: pos.top,
              transform: `translate(-50%, ${pos.below ? '0' : '-100%'})`,
            }}
            className="fixed z-[300] max-w-[260px] px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-[11px] leading-relaxed text-slate-300 shadow-xl pointer-events-none"
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
