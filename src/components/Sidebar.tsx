import type { DragEvent } from 'react';
import { X, StickyNote } from 'lucide-react';
import { useCoarsePointer } from '../hooks/useCoarsePointer';

export function Sidebar({
  isOpen,
  onClose,
  onPickPart,
  onAddNoteCard,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Place a part without dragging it — see `partProps` below. */
  onPickPart?: (nodeType: string, label?: string) => void;
  /** Put a blank note card on the canvas. */
  onAddNoteCard?: () => void;
}) {
  const coarsePointer = useCoarsePointer();

  if (!isOpen) return null;

  const onDragStart = (event: DragEvent, nodeType: string, label?: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    if (label) event.dataTransfer.setData('application/reactflow-label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  /**
   * How a palette entry gets onto the canvas.
   *
   * Dragging is the whole interaction on a desktop and is untouched. HTML5
   * drag-and-drop, though, simply does not fire for touch input — on a phone
   * every part in this palette was inert, which is to say the app could open a
   * saved circuit but never build one. So on a coarse pointer a tap drops the
   * part into the middle of the canvas instead and puts the drawer away, ready
   * to be dragged into place with a finger like any other node.
   *
   * Gated on the pointer rather than the width so a click on a desktop still
   * only selects text, never silently adds a component.
   */
  const partProps = (nodeType: string, label?: string) => ({
    className: itemClass,
    draggable: true,
    onDragStart: (event: DragEvent) => onDragStart(event, nodeType, label),
    ...(coarsePointer
      ? {
          onClick: () => {
            onPickPart?.(nodeType, label);
            onClose();
          },
        }
      : {}),
  });

  const itemClass = "px-1 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center text-center cursor-grab hover:border-emerald-400 dark:hover:border-emerald-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all group";
  const sectionTitleClass = "text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-3 mb-1.5";
  // One ink for every palette icon; the section heading carries the category.
  const iconClass = "mb-0.5 text-slate-600 dark:text-slate-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors";

  return (
    /* z-[120] below `lg`, above the note card's 100: as an overlay the drawer
       has to cover what it is drawn on top of, and a card left floating over
       the palette swallowed the taps meant for the parts underneath it. At
       `lg` the palette is a column in the flow and keeps its old `z-10`. */
    <div className="fixed inset-0 z-[120] lg:relative lg:z-10 flex h-full pointer-events-none">
      {/* Backdrop for mobile */}
      <div 
        className="fixed inset-0 bg-slate-900/20 backdrop-blur-xs lg:hidden pointer-events-auto" 
        onClick={onClose}
      ></div>
      <aside className="w-64 md:w-56 shrink-0 h-full glass-panel border-r border-slate-200 dark:border-slate-800 px-3 py-3 flex flex-col bg-white/95 dark:bg-slate-900/95 shadow-xl lg:shadow-none z-50 relative overflow-y-auto pointer-events-auto transition-colors">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Components</h2>
          <button onClick={onClose} className="lg:hidden p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 dark:text-slate-400">
            <X size={18} />
          </button>
        </div>
        {coarsePointer && (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">
            Tap a part to drop it on the canvas.
          </p>
        )}

        {onAddNoteCard && (
          <>
            <div className={sectionTitleClass}>Annotation</div>
            {/* Not a part: a note card is a canvas overlay, not a node, so it
                is placed on click rather than dragged onto a position. */}
            <button
              type="button"
              className={itemClass + ' w-full cursor-pointer'}
              onClick={() => { onAddNoteCard(); onClose(); }}
            >
              <div className={iconClass}>
                <StickyNote size={22} strokeWidth={1.8} />
              </div>
              <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Note Card</span>
            </button>
          </>
        )}

        <div className={sectionTitleClass}>Transistors</div>
        <div className="grid grid-cols-2 gap-1.5">
          <div 
            {...partProps('npn')}
          >
            <div className={iconClass}>
              <svg width="22" height="22" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="20" y1="10" x2="20" y2="50" strokeWidth="3" />
                <line x1="5" y1="30" x2="20" y2="30" />
                <line x1="20" y1="20" x2="45" y2="7" />
                <line x1="20" y1="40" x2="45" y2="53" />
                <polygon points="45,53 35,46 41,38" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">NPN BJT</span>
          </div>
          <div 
            {...partProps('pnp')}
          >
            <div className={iconClass}>
              <svg width="22" height="22" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="20" y1="10" x2="20" y2="50" strokeWidth="3" />
                <line x1="5" y1="30" x2="20" y2="30" />
                <line x1="20" y1="20" x2="45" y2="7" />
                <line x1="20" y1="40" x2="45" y2="53" />
                <polygon points="20,20 30,17 26,27" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">PNP BJT</span>
          </div>
          <div 
            {...partProps('nmos')}
          >
            <div className={iconClass}>
              <svg width="22" height="22" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="15" y1="15" x2="15" y2="45" strokeWidth="3" />
                <line x1="22" y1="15" x2="22" y2="45" strokeWidth="3" />
                <line x1="5" y1="30" x2="15" y2="30" />
                <line x1="22" y1="20" x2="45" y2="20" />
                <line x1="22" y1="40" x2="45" y2="40" />
                <line x1="22" y1="30" x2="45" y2="30" />
                <polygon points="22,30 32,25 32,35" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">NMOS</span>
          </div>
          <div 
            {...partProps('pmos')}
          >
            <div className={iconClass}>
              <svg width="22" height="22" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="15" y1="15" x2="15" y2="45" strokeWidth="3" />
                <line x1="22" y1="15" x2="22" y2="45" strokeWidth="3" />
                <line x1="5" y1="30" x2="15" y2="30" />
                <line x1="22" y1="20" x2="45" y2="20" />
                <line x1="22" y1="40" x2="45" y2="40" />
                <line x1="22" y1="30" x2="45" y2="30" />
                <polygon points="45,30 35,25 35,35" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">PMOS</span>
          </div>
        </div>

        <div className={sectionTitleClass}>Logic Gates</div>
        <div className="grid grid-cols-2 gap-1.5">
          {['and', 'or', 'not', 'nand', 'nor', 'xor'].map((gate) => {
            return (
              <div 
                key={gate}
                {...partProps(gate)}
              >
                <div className={iconClass}>
                  {gate === 'and' && (
                    <svg width="20" height="20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M 20 20 H 50 A 30 30 0 0 1 80 50 A 30 30 0 0 1 50 80 H 20 Z" />
                    </svg>
                  )}
                  {gate === 'or' && (
                    <svg width="20" height="20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M 20 20 C 35 20, 50 30, 80 50 C 50 70, 35 80, 20 80 C 35 50, 35 50, 20 20 Z" />
                    </svg>
                  )}
                  {gate === 'not' && (
                    <svg width="20" height="20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polygon points="20,20 20,80 70,50" />
                      <circle cx="78" cy="50" r="8" fill="none" />
                    </svg>
                  )}
                  {gate === 'nand' && (
                    <svg width="20" height="20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M 15 20 H 45 A 30 30 0 0 1 75 50 A 30 30 0 0 1 45 80 H 15 Z" />
                      <circle cx="83" cy="50" r="8" fill="none" />
                    </svg>
                  )}
                  {gate === 'nor' && (
                    <svg width="20" height="20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M 15 20 C 30 20, 45 30, 75 50 C 45 70, 30 80, 15 80 C 30 50, 30 50, 15 20 Z" />
                      <circle cx="83" cy="50" r="8" fill="none" />
                    </svg>
                  )}
                  {gate === 'xor' && (
                    <svg width="20" height="20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M 15 20 C 25 35, 25 65, 15 80" />
                      <path d="M 22 20 C 37 20, 52 30, 82 50 C 52 70, 37 80, 22 80 C 37 50, 37 50, 22 20 Z" />
                    </svg>
                  )}
                </div>
                <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 capitalize">{gate} Gate</span>
              </div>
            );
          })}
        </div>

        <div className={sectionTitleClass}>Tools</div>
        <div className="grid grid-cols-2 gap-1.5">
          {/* DC Voltage */}
          <div 
            {...partProps('voltage', '5V')}
          >
            <div className={iconClass}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="16" />
                <path d="M 24 13 V 19" />
                <path d="M 21 16 H 27" />
                <path d="M 21 32 H 27" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">DC Voltage</span>
          </div>

          {/* Ground */}
          <div 
            {...partProps('ground')}
          >
            <div className={iconClass}>
              <svg width="20" height="18" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 6h16 M7 11h10 M10 16h4" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Ground</span>
          </div>

          {/* Resistor */}
          <div 
            {...partProps('resistor', '1k')}
          >
            <div className={iconClass}>
              <svg width="30" height="16" viewBox="0 0 80 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 20 H 25 L 27.5 10 L 32.5 30 L 37.5 10 L 42.5 30 L 47.5 10 L 52.5 30 L 55 20 H 80" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Resistor</span>
          </div>

          {/* Capacitor */}
          <div 
            {...partProps('capacitor', '10u')}
          >
            <div className={iconClass}>
              <svg width="26" height="20" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 24 H 29" />
                <path d="M 29 12 V 36" strokeWidth="2.5" />
                <path d="M 35 12 V 36" strokeWidth="2.5" />
                <path d="M 35 24 H 64" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Capacitor</span>
          </div>

          {/* Inductor */}
          <div 
            {...partProps('inductor', '100u')}
          >
            <div className={iconClass}>
              <svg width="30" height="16" viewBox="0 0 80 40" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M 0 20 H 16 A 6,6 0 0,1 28,20 A 6,6 0 0,1 40,20 A 6,6 0 0,1 52,20 A 6,6 0 0,1 64,20 H 80" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Inductor</span>
          </div>

          {/* Diode */}
          <div 
            {...partProps('diode')}
          >
            <div className={iconClass}>
              <svg width="26" height="20" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 24 H 24" />
                <path d="M 24 14 L 36 24 L 24 34 Z" fill="currentColor" />
                <path d="M 36 14 V 34" strokeWidth="2.5" />
                <path d="M 36 24 H 64" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Diode</span>
          </div>

          {/* LED */}
          <div 
            {...partProps('led')}
          >
            <div className={iconClass}>
              <svg width="26" height="20" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 24 H 24" />
                <path d="M 24 14 L 36 24 L 24 34 Z" fill="currentColor" />
                <path d="M 36 14 V 34" strokeWidth="2.5" />
                <path d="M 36 24 H 64" />
                <path d="M 28 14 L 34 8 M 32 8 H 34 V 10" strokeWidth="1" />
                <path d="M 32 18 L 38 12 M 36 12 H 38 V 14" strokeWidth="1" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">LED</span>
          </div>

          {/* 555 Timer */}
          <div 
            {...partProps('timer555')}
          >
            <div className={iconClass}>
              <div className="border border-cyan-300 dark:border-cyan-700 rounded px-1.5 py-0.5 text-[9px] font-bold">NE555</div>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">555 Timer</span>
          </div>

          {/* Microcontroller */}
          <div 
            {...partProps('mcu')}
          >
            <div className={iconClass}>
              <div className="border border-indigo-300 dark:border-indigo-700 rounded px-1.5 py-0.5 text-[9px] font-bold">MCU</div>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">MCU</span>
          </div>

          {/* Heltec V4 HIL */}
          <div 
            {...partProps('heltec_v4')}
          >
            <div className={iconClass}>
              <div className="border border-emerald-300 dark:border-emerald-700 rounded px-1 py-0.5 text-[9px] font-bold">HELTEC</div>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Heltec V4</span>
          </div>

          {/* Op-Amp */}
          <div 
            {...partProps('opamp')}
          >
            <div className={iconClass}>
              <svg width="24" height="20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="10,10 10,90 90,50" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Op-Amp</span>
          </div>

          {/* Multimeter */}
          <div 
            {...partProps('multimeter')}
          >
            <div className={iconClass}>
              <div className="border border-emerald-300 dark:border-emerald-700 rounded px-1 py-0.5 font-mono text-[8px] font-bold">0.00 V</div>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Multimeter</span>
          </div>

          {/* DC Source */}
          <div 
            {...partProps('voltage', '5V')}
          >
            <div className={iconClass}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="16" />
                <path d="M 24 13 V 19" />
                <path d="M 21 16 H 27" />
                <path d="M 21 32 H 27" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">DC Source</span>
          </div>

          {/* AC Source */}
          <div 
            {...partProps('acvoltage', '10V 60Hz')}
          >
            <div className={iconClass}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="16" />
                <path d="M 16 24 C 18 16, 22 16, 24 24 C 26 32, 30 32, 32 24" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">AC Source</span>
          </div>

          {/* Signal Gen */}
          <div 
            {...partProps('signalgen')}
          >
            <div className={iconClass}>
              <div className="border border-teal-300 dark:border-teal-700 rounded px-1 py-0.5 text-[8px] font-bold">~ SINE</div>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Signal Gen</span>
          </div>

          {/* Oscilloscope */}
          <div 
            {...partProps('scope')}
          >
            <div className={iconClass}>
              <div className="border border-indigo-300 dark:border-indigo-700 rounded w-9 h-5 flex items-center justify-center overflow-hidden">
                <svg width="100%" height="100%" viewBox="0 0 100 60" fill="none" stroke="currentColor" strokeWidth="4">
                  <polyline points="0,30 25,10 50,50 75,10 100,30" fill="none" />
                </svg>
              </div>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Scope</span>
          </div>

          {/* Speaker */}
          <div 
            {...partProps('speaker')}
          >
            <div className={iconClass}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Speaker</span>
          </div>

          {/* Mic */}
          <div 
            {...partProps('microphone')}
          >
            <div className={iconClass}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Mic</span>
          </div>

          {/* Switch */}
          <div 
            {...partProps('switch')}
          >
            <div className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="18" viewBox="0 0 40 30" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="10" cy="20" r="3" fill="currentColor" />
                <circle cx="30" cy="20" r="3" fill="currentColor" />
                <line x1="10" y1="20" x2="30" y2="5" stroke="currentColor" strokeLinecap="round" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Switch</span>
          </div>

          {/* Pot */}
          <div 
            {...partProps('potentiometer', '10k')}
          >
            <div className={iconClass}>
              <svg width="24" height="18" viewBox="0 0 32 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="4" width="28" height="6" rx="1"/>
                <line x1="16" y1="0" x2="16" y2="5"/>
                <path d="M13,3 L16,0 L19,3"/>
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Pot</span>
          </div>

          {/* 7-Seg */}
          <div 
            {...partProps('sevenseg')}
          >
            <div className={iconClass}>
              <div className="border border-sky-300 dark:border-sky-700 rounded w-5 h-5 flex items-center justify-center font-mono text-[10px] font-bold">8</div>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">7-Seg</span>
          </div>

          {/* I Source */}
          <div 
            {...partProps('currentsource', '10m')}
          >
            <div className={iconClass}>
              <svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="14" cy="14" r="12" />
                <line x1="14" y1="20" x2="14" y2="8" />
                <path d="M10,12 L14,8 L18,12" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">I Source</span>
          </div>

          {/* Transformer */}
          <div 
            {...partProps('transformer')}
          >
            <div className={iconClass}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M 8 16 H 18 A 4 4 0 0 1 18 24 A 4 4 0 0 1 18 32 H 8" />
                <path d="M 40 16 H 30 A 4 4 0 0 0 30 24 A 4 4 0 0 0 30 32 H 40" />
                <line x1="22" y1="12" x2="22" y2="36" />
                <line x1="26" y1="12" x2="26" y2="36" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Transformer</span>
          </div>

          {/* D Flip-Flop */}
          <div 
            {...partProps('dff')}
          >
            <div className={iconClass}>
              <div className="border border-indigo-300 dark:border-indigo-700 rounded px-1.5 py-0.5 text-[8px] font-bold">DFF</div>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">D Flip-Flop</span>
          </div>

          {/* LDR */}
          <div 
            {...partProps('ldr')}
          >
            <div className={iconClass}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="12" />
                <path d="M 14 24 L 17 20 L 21 28 L 25 20 L 29 28 L 31 20 L 34 24" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">LDR</span>
          </div>
        </div>

        {/*
          Board-only parts. These are placed and milled but contribute nothing
          to the simulation, so they live in their own section rather than
          mixed in with the components.
        */}
        <div className={sectionTitleClass}>PCB / Mechanical</div>
        <div className="grid grid-cols-2 gap-1.5">
          {/* Pin Header */}
          <div {...partProps('pinheader', 'Header')}>
            <div className={iconClass}>
              <svg width="26" height="16" viewBox="0 0 52 32" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="8" width="48" height="16" rx="2" />
                <circle cx="11" cy="16" r="2.5" fill="currentColor" stroke="none" />
                <circle cx="21" cy="16" r="2.5" fill="currentColor" stroke="none" />
                <circle cx="31" cy="16" r="2.5" fill="currentColor" stroke="none" />
                <circle cx="41" cy="16" r="2.5" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Pin Header</span>
          </div>

          {/* Via */}
          <div {...partProps('via', 'Via')}>
            <div className={iconClass}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3">
                <circle cx="24" cy="24" r="14" />
                <circle cx="24" cy="24" r="5" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Via</span>
          </div>

          {/* Mounting Hole */}
          <div {...partProps('mountinghole', 'Mount')}>
            <div className={iconClass}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="18" strokeDasharray="4 4" />
                <circle cx="24" cy="24" r="9" strokeWidth="2.5" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Mounting Hole</span>
          </div>

          {/* Wire Jumper */}
          <div {...partProps('jumper', 'Jumper')}>
            <div className={iconClass}>
              <svg width="26" height="16" viewBox="0 0 52 32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M 10 22 Q 26 2 42 22" />
                <circle cx="10" cy="22" r="3.5" fill="currentColor" stroke="none" />
                <circle cx="42" cy="22" r="3.5" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Wire Jumper</span>
          </div>

          {/* Board Cutout */}
          <div {...partProps('cutout', 'Cutout')}>
            <div className={iconClass}>
              <svg width="24" height="18" viewBox="0 0 48 36" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="2" width="44" height="32" rx="2" />
                <rect x="14" y="11" width="20" height="14" rx="1.5" strokeDasharray="3 2.5" />
              </svg>
            </div>
            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">Board Cutout</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
