// ---------------------------------------------------------------------------
// First-visit interactive coachmark tour with hand-drawn SVG sketch arrows
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { START_TOUR_EVENT } from '../utils/deepLink';

interface TourStep {
  target: string;
  title: string;
  body: string;
}

const STORAGE_KEY = 'volt_onboarding_tour_v1';

const VOLT_TOUR_STEPS: TourStep[] = [
  {
    target: 'preset-picker',
    title: '1. Open a starter circuit',
    body: 'Start with Basic Blink, a 555 Timer flasher, a dimmer knob, audio pedals, Arduino/ESP32 sketches, or motor drivers.',
  },
  {
    target: 'left-parts',
    title: '2. Drag parts & wire pins together',
    body: 'Pull batteries, resistors, LEDs, switches, op-amps, speakers, and microcontrollers onto the grid and connect their pins.',
  },
  {
    target: 'sim-run',
    title: '3. Press Run to power it up',
    body: 'Watch LEDs glow (or pop if overloaded!), hear real audio through Speaker nodes, and catch wiring mistakes automatically.',
  },
  {
    target: 'inspect-bar',
    title: '4. Probe wires, read DC & Link Mesh',
    body: 'Click Probe to inspect live waveforms on any wire, stamp DC voltages onto every net, run Bode sweeps, or drive 3D motors in Mesh.',
  },
  {
    target: 'make-btn',
    title: '5. Turn your schematic into a real PCB',
    body: 'Click Make to auto-place and route a 1- or 2-layer copper board, export Gerbers, cut paste stencils, or mill FR4 live.',
  },
];

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function shouldAutoOpen(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('tour') === '1' || params.get('tour') === 'true') return true;
  if (params.get('mcp') || params.get('s') || params.get('open') || params.get('modal')) return false;
  if (window.location.hash.length > 2) return false;
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
}

function sketchArrowPaths(x1: number, y1: number, x2: number, y2: number): { shaft: string; shaft2: string; head: string } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const bend = Math.min(48, Math.max(18, len * 0.22)) * (dx >= 0 ? -1 : 1);
  const nx = -dy / len;
  const ny = dx / len;
  const cx = (x1 + x2) * 0.5 + nx * bend;
  const cy = (y1 + y2) * 0.5 + ny * bend;

  const tx = x2 - cx;
  const ty = y2 - cy;
  const tLen = Math.max(1, Math.hypot(tx, ty));
  const ux = tx / tLen;
  const uy = ty / tLen;
  const wing = 13;
  const spread = 0.48;
  const cos = Math.cos(spread);
  const sin = Math.sin(spread);

  const lx = x2 - wing * (ux * cos - uy * sin);
  const ly = y2 - wing * (uy * cos + ux * sin);
  const rx = x2 - wing * (ux * cos + uy * sin);
  const ry = y2 - wing * (uy * cos - ux * sin);

  const f = (n: number) => n.toFixed(1);
  return {
    shaft: `M ${f(x1)} ${f(y1)} Q ${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}`,
    shaft2: `M ${f(x1 + 1.2)} ${f(y1 + 0.8)} Q ${f(cx - 1.8)} ${f(cy + 1.4)} ${f(x2 - 0.6)} ${f(y2 - 0.5)}`,
    head: `M ${f(lx)} ${f(ly)} Q ${f((lx + x2) * 0.5 + 1)} ${f((ly + y2) * 0.5)} ${f(x2)} ${f(y2)} Q ${f((rx + x2) * 0.5)} ${f((ry + y2) * 0.5 + 1)} ${f(rx)} ${f(ry)}`,
  };
}

export const WelcomeTourOverlay: React.FC = () => {
  const [open, setOpen] = useState<boolean>(shouldAutoOpen);
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  const close = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);

  useEffect(() => {
    const onStart = () => {
      setStepIdx(0);
      setOpen(true);
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, []);

  const step = VOLT_TOUR_STEPS[stepIdx] ?? VOLT_TOUR_STEPS[0];

  const measure = useCallback(() => {
    if (typeof window === 'undefined') return;
    setVp({ w: window.innerWidth, h: window.innerHeight });
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      setTargetRect(null);
      return;
    }
    setTargetRect({ left: r.left, top: r.top, width: r.width, height: r.height });
  }, [step.target]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 120);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') {
        if (stepIdx < VOLT_TOUR_STEPS.length - 1) setStepIdx((i) => i + 1);
        else close();
      } else if (e.key === 'ArrowLeft' && stepIdx > 0) {
        setStepIdx((i) => i - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, stepIdx, measure, close]);

  if (!open) return null;

  const cardW = Math.min(340, vp.w - 24);
  const cardH = 196;
  const pad = 8;

  let cardLeft = Math.round((vp.w - cardW) * 0.5);
  let cardTop = Math.round((vp.h - cardH) * 0.5);
  let arrow: { x1: number; y1: number; x2: number; y2: number } | null = null;

  if (targetRect) {
    const tcx = targetRect.left + targetRect.width * 0.5;
    const tcy = targetRect.top + targetRect.height * 0.5;
    const isNearBottom = tcy > vp.h * 0.68;
    const isLeftRail = targetRect.left < 90 && targetRect.height > 180;

    if (isLeftRail) {
      cardLeft = Math.min(vp.w - cardW - 16, Math.max(16, Math.round(targetRect.left + targetRect.width + 64)));
      cardTop = Math.min(vp.h - cardH - 24, Math.max(72, Math.round(targetRect.top + 48)));
      arrow = {
        x1: cardLeft - 8,
        y1: cardTop + 56,
        x2: targetRect.left + targetRect.width + pad,
        y2: Math.min(vp.h - 60, targetRect.top + Math.min(140, targetRect.height * 0.35)),
      };
    } else if (isNearBottom) {
      cardLeft = Math.min(vp.w - cardW - 16, Math.max(16, Math.round(tcx - cardW * 0.5)));
      cardTop = Math.max(16, Math.round(targetRect.top - cardH - 62));
      arrow = {
        x1: Math.min(cardLeft + cardW - 32, Math.max(cardLeft + 32, tcx + 24)),
        y1: cardTop + cardH + 6,
        x2: Math.min(vp.w - 24, Math.max(24, tcx)),
        y2: targetRect.top - pad,
      };
    } else {
      cardLeft = Math.min(vp.w - cardW - 16, Math.max(16, Math.round(tcx - cardW * 0.5)));
      cardTop = Math.min(vp.h - cardH - 16, Math.round(targetRect.top + targetRect.height + 58));
      arrow = {
        x1: Math.min(cardLeft + cardW - 32, Math.max(cardLeft + 32, tcx + 24)),
        y1: cardTop - 6,
        x2: Math.min(vp.w - 24, Math.max(24, tcx)),
        y2: targetRect.top + targetRect.height + pad,
      };
    }
  }

  const paths = arrow ? sketchArrowPaths(arrow.x1, arrow.y1, arrow.x2, arrow.y2) : null;
  const isLast = stepIdx === VOLT_TOUR_STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Quick workspace tour"
      className="fixed inset-0 z-[140] pointer-events-none select-none"
    >
      <svg className="fixed inset-0 w-full h-full pointer-events-auto" onClick={close}>
        <defs>
          <mask id="volt-tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={Math.max(0, targetRect.left - pad)}
                y={Math.max(0, targetRect.top - pad)}
                width={targetRect.width + pad * 2}
                height={targetRect.height + pad * 2}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(15, 23, 42, 0.58)" mask="url(#volt-tour-mask)" />
        {targetRect && (
          <rect
            x={Math.max(0, targetRect.left - pad)}
            y={Math.max(0, targetRect.top - pad)}
            width={targetRect.width + pad * 2}
            height={targetRect.height + pad * 2}
            rx="12"
            fill="none"
            stroke="#34d399"
            strokeWidth="2.2"
            strokeDasharray="7 4"
          />
        )}
        {paths && (
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d={paths.shaft} stroke="rgba(15,23,42,0.55)" strokeWidth="5.5" />
            <path d={paths.head} stroke="rgba(15,23,42,0.55)" strokeWidth="5.5" />
            <path d={paths.shaft} stroke="#34d399" strokeWidth="2.8" />
            <path d={paths.shaft2} stroke="#a7f3d0" strokeWidth="1.3" strokeDasharray="5 3" opacity="0.85" />
            <path d={paths.head} stroke="#34d399" strokeWidth="2.8" />
          </g>
        )}
      </svg>

      <div
        style={{ left: `${cardLeft}px`, top: `${cardTop}px`, width: `${cardW}px` }}
        onClick={(e) => e.stopPropagation()}
        className="fixed pointer-events-auto rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-400/80 dark:border-emerald-400/70 shadow-2xl p-4 text-slate-800 dark:text-slate-100 transition-all duration-200"
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            <Sparkles className="w-3.5 h-3.5" />
            Quick Tour · {stepIdx + 1} of {VOLT_TOUR_STEPS.length}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Dismiss tour"
            title="Dismiss tour (Esc)"
            className="p-1 -m-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">{step.title}</h3>
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 mb-3.5">{step.body}</p>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={close}
            className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-1.5">
            {VOLT_TOUR_STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => setStepIdx(i)}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  i === stepIdx ? 'w-4 bg-emerald-500' : 'w-1.5 bg-slate-300 dark:bg-slate-700'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1">
            {stepIdx > 0 && (
              <button
                type="button"
                onClick={() => setStepIdx((i) => i - 1)}
                aria-label="Previous step"
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLast) close();
                else setStepIdx((i) => i + 1);
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs shadow-xs cursor-pointer"
            >
              <span>{isLast ? 'Start building' : 'Next'}</span>
              {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
