import type { DragEvent } from 'react';
import { X } from 'lucide-react';

export function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  const onDragStart = (event: DragEvent, nodeType: string, label?: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    if (label) event.dataTransfer.setData('application/reactflow-label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  const itemClass = "p-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 shadow-xs flex flex-col items-center justify-center text-center cursor-grab hover:border-blue-400 dark:hover:border-blue-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all group";
  const sectionTitleClass = "text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-3 mb-2";

  return (
    <div className="fixed inset-0 z-40 lg:relative lg:z-10 flex h-full pointer-events-none">
      {/* Backdrop for mobile */}
      <div 
        className="fixed inset-0 bg-slate-900/20 backdrop-blur-xs lg:hidden pointer-events-auto" 
        onClick={onClose}
      ></div>
      <aside className="w-64 md:w-56 shrink-0 h-full glass-panel border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col bg-white/95 dark:bg-slate-900/95 shadow-xl lg:shadow-none z-50 relative overflow-y-auto pointer-events-auto transition-colors">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Components</h2>
          <button onClick={onClose} className="lg:hidden p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 dark:text-slate-400">
            <X size={18} />
          </button>
        </div>
      
        <div className={sectionTitleClass}>Transistors</div>
        <div className="grid grid-cols-2 gap-2">
          <div 
            onDragStart={(event) => onDragStart(event, 'npn')} 
            draggable 
            className={itemClass}
          >
            <div className="p-1.5 bg-blue-50 dark:bg-blue-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-blue-600 dark:text-blue-400">
              <svg width="22" height="22" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="20" y1="10" x2="20" y2="50" strokeWidth="3" />
                <line x1="5" y1="30" x2="20" y2="30" />
                <line x1="20" y1="20" x2="45" y2="7" />
                <line x1="20" y1="40" x2="45" y2="53" />
                <polygon points="45,53 35,46 41,38" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">NPN BJT</span>
          </div>
          <div 
            onDragStart={(event) => onDragStart(event, 'pnp')} 
            draggable 
            className={itemClass}
          >
            <div className="p-1.5 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-indigo-600 dark:text-indigo-400">
              <svg width="22" height="22" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="20" y1="10" x2="20" y2="50" strokeWidth="3" />
                <line x1="5" y1="30" x2="20" y2="30" />
                <line x1="20" y1="20" x2="45" y2="7" />
                <line x1="20" y1="40" x2="45" y2="53" />
                <polygon points="20,20 30,17 26,27" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">PNP BJT</span>
          </div>
          <div 
            onDragStart={(event) => onDragStart(event, 'nmos')} 
            draggable 
            className={itemClass}
          >
            <div className="p-1.5 bg-sky-50 dark:bg-sky-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-sky-600 dark:text-sky-400">
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
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">NMOS</span>
          </div>
          <div 
            onDragStart={(event) => onDragStart(event, 'pmos')} 
            draggable 
            className={itemClass}
          >
            <div className="p-1.5 bg-cyan-50 dark:bg-cyan-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-cyan-600 dark:text-cyan-400">
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
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">PMOS</span>
          </div>
        </div>

        <div className={sectionTitleClass}>Logic Gates</div>
        <div className="grid grid-cols-2 gap-2">
          {['and', 'or', 'not', 'nand', 'nor', 'xor'].map((gate, i) => {
            const colors = [
              "bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400",
              "bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400",
              "bg-fuchsia-50 dark:bg-fuchsia-950/30 text-fuchsia-600 dark:text-fuchsia-400",
              "bg-pink-50 dark:bg-pink-950/30 text-pink-600 dark:text-pink-400",
              "bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400",
              "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400"
            ];
            return (
              <div 
                key={gate}
                onDragStart={(event) => onDragStart(event, gate)} 
                draggable 
                className={itemClass}
              >
                <div className={`p-1.5 rounded-lg mb-1 group-hover:scale-105 transition-transform ${colors[i % colors.length]}`}>
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
        <div className="grid grid-cols-2 gap-2">
          {/* DC Voltage */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'voltage', '5V')} draggable
          >
            <div className="p-1.5 bg-amber-50 dark:bg-amber-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-amber-600 dark:text-amber-400">
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="16" />
                <path d="M 24 13 V 19" />
                <path d="M 21 16 H 27" />
                <path d="M 21 32 H 27" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">DC Voltage</span>
          </div>

          {/* Ground */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'ground')} draggable
          >
            <div className="p-1.5 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-emerald-600 dark:text-emerald-400">
              <svg width="20" height="18" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 6h16 M7 11h10 M10 16h4" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Ground</span>
          </div>

          {/* Resistor */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'resistor', '1k')} draggable
          >
            <div className="p-1.5 bg-rose-50 dark:bg-rose-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-rose-600 dark:text-rose-400">
              <svg width="30" height="16" viewBox="0 0 80 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 20 H 25 L 27.5 10 L 32.5 30 L 37.5 10 L 42.5 30 L 47.5 10 L 52.5 30 L 55 20 H 80" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Resistor</span>
          </div>

          {/* Capacitor */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'capacitor', '10u')} draggable
          >
            <div className="p-1.5 bg-sky-50 dark:bg-sky-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-sky-600 dark:text-sky-400">
              <svg width="26" height="20" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 24 H 29" />
                <path d="M 29 12 V 36" strokeWidth="2.5" />
                <path d="M 35 12 V 36" strokeWidth="2.5" />
                <path d="M 35 24 H 64" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Capacitor</span>
          </div>

          {/* Inductor */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'inductor', '100u')} draggable
          >
            <div className="p-1.5 bg-teal-50 dark:bg-teal-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-teal-600 dark:text-teal-400">
              <svg width="30" height="16" viewBox="0 0 80 40" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M 0 20 H 16 A 6,6 0 0,1 28,20 A 6,6 0 0,1 40,20 A 6,6 0 0,1 52,20 A 6,6 0 0,1 64,20 H 80" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Inductor</span>
          </div>

          {/* Diode */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'diode')} draggable
          >
            <div className="p-1.5 bg-red-50 dark:bg-red-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-red-600 dark:text-red-400">
              <svg width="26" height="20" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 24 H 24" />
                <path d="M 24 14 L 36 24 L 24 34 Z" fill="currentColor" />
                <path d="M 36 14 V 34" strokeWidth="2.5" />
                <path d="M 36 24 H 64" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Diode</span>
          </div>

          {/* LED */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'led')} draggable
          >
            <div className="p-1.5 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-yellow-600 dark:text-yellow-400">
              <svg width="26" height="20" viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 0 24 H 24" />
                <path d="M 24 14 L 36 24 L 24 34 Z" fill="currentColor" />
                <path d="M 36 14 V 34" strokeWidth="2.5" />
                <path d="M 36 24 H 64" />
                <path d="M 28 14 L 34 8 M 32 8 H 34 V 10" strokeWidth="1" />
                <path d="M 32 18 L 38 12 M 36 12 H 38 V 14" strokeWidth="1" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">LED</span>
          </div>

          {/* 555 Timer */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'timer555')} draggable
          >
            <div className="p-1.5 bg-cyan-50 dark:bg-cyan-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-cyan-600 dark:text-cyan-400">
              <div className="border border-cyan-300 dark:border-cyan-700 rounded px-1.5 py-0.5 text-[9px] font-bold">NE555</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">555 Timer</span>
          </div>

          {/* Microcontroller */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'mcu')} draggable
          >
            <div className="p-1.5 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-indigo-600 dark:text-indigo-400">
              <div className="border border-indigo-300 dark:border-indigo-700 rounded px-1.5 py-0.5 text-[9px] font-bold">MCU</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">MCU</span>
          </div>

          {/* Heltec V4 HIL */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'heltec_v4')} draggable
          >
            <div className="p-1.5 bg-blue-50 dark:bg-blue-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-blue-600 dark:text-blue-400">
              <div className="border border-blue-300 dark:border-blue-700 rounded px-1 py-0.5 text-[9px] font-bold">HELTEC</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Heltec V4</span>
          </div>

          {/* Op-Amp */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'opamp')} draggable
          >
            <div className="p-1.5 bg-violet-50 dark:bg-violet-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-violet-600 dark:text-violet-400">
              <svg width="24" height="20" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="10,10 10,90 90,50" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Op-Amp</span>
          </div>

          {/* Multimeter */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'multimeter')} draggable
          >
            <div className="p-1.5 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-emerald-600 dark:text-emerald-400">
              <div className="border border-emerald-300 dark:border-emerald-700 rounded px-1 py-0.5 font-mono text-[8px] font-bold">0.00 V</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Multimeter</span>
          </div>

          {/* DC Source */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'voltage', '5V')} draggable
          >
            <div className="p-1.5 bg-amber-50 dark:bg-amber-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-amber-600 dark:text-amber-400">
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="16" />
                <path d="M 24 13 V 19" />
                <path d="M 21 16 H 27" />
                <path d="M 21 32 H 27" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">DC Source</span>
          </div>

          {/* AC Source */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'acvoltage', '10V 60Hz')} draggable
          >
            <div className="p-1.5 bg-orange-50 dark:bg-orange-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-orange-600 dark:text-orange-400">
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="16" />
                <path d="M 16 24 C 18 16, 22 16, 24 24 C 26 32, 30 32, 32 24" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">AC Source</span>
          </div>

          {/* Signal Gen */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'signalgen')} draggable
          >
            <div className="p-1.5 bg-teal-50 dark:bg-teal-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-teal-600 dark:text-teal-400">
              <div className="border border-teal-300 dark:border-teal-700 rounded px-1 py-0.5 text-[8px] font-bold">~ SINE</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Signal Gen</span>
          </div>

          {/* Oscilloscope */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'scope')} draggable
          >
            <div className="p-1.5 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-indigo-600 dark:text-indigo-400">
              <div className="border border-indigo-300 dark:border-indigo-700 rounded w-9 h-5 flex items-center justify-center overflow-hidden">
                <svg width="100%" height="100%" viewBox="0 0 100 60" fill="none" stroke="currentColor" strokeWidth="4">
                  <polyline points="0,30 25,10 50,50 75,10 100,30" fill="none" />
                </svg>
              </div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Scope</span>
          </div>

          {/* Speaker */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'speaker')} draggable
          >
            <div className="p-1.5 bg-fuchsia-50 dark:bg-fuchsia-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-fuchsia-600 dark:text-fuchsia-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Speaker</span>
          </div>

          {/* Mic */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'microphone')} draggable
          >
            <div className="p-1.5 bg-purple-50 dark:bg-purple-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-purple-600 dark:text-purple-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Mic</span>
          </div>

          {/* Switch */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'switch')} draggable
          >
            <div className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg mb-1 group-hover:scale-105 transition-transform text-slate-700 dark:text-slate-300">
              <svg width="24" height="18" viewBox="0 0 40 30" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="10" cy="20" r="3" fill="currentColor" />
                <circle cx="30" cy="20" r="3" fill="currentColor" />
                <line x1="10" y1="20" x2="30" y2="5" stroke="currentColor" strokeLinecap="round" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Switch</span>
          </div>

          {/* Pot */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'potentiometer', '10k')} draggable
          >
            <div className="p-1.5 bg-rose-50 dark:bg-rose-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-rose-600 dark:text-rose-400">
              <svg width="24" height="18" viewBox="0 0 32 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="4" width="28" height="6" rx="1"/>
                <line x1="16" y1="0" x2="16" y2="5"/>
                <path d="M13,3 L16,0 L19,3"/>
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Pot</span>
          </div>

          {/* 7-Seg */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'sevenseg')} draggable
          >
            <div className="p-1.5 bg-sky-50 dark:bg-sky-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-sky-600 dark:text-sky-400">
              <div className="border border-sky-300 dark:border-sky-700 rounded w-5 h-5 flex items-center justify-center font-mono text-[10px] font-bold">8</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">7-Seg</span>
          </div>

          {/* I Source */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'currentsource', '10m')} draggable
          >
            <div className="p-1.5 bg-amber-50 dark:bg-amber-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-amber-600 dark:text-amber-400">
              <svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="14" cy="14" r="12" />
                <line x1="14" y1="20" x2="14" y2="8" />
                <path d="M10,12 L14,8 L18,12" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">I Source</span>
          </div>

          {/* Transformer */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'transformer')} draggable
          >
            <div className="p-1.5 bg-teal-50 dark:bg-teal-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-teal-600 dark:text-teal-400">
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M 8 16 H 18 A 4 4 0 0 1 18 24 A 4 4 0 0 1 18 32 H 8" />
                <path d="M 40 16 H 30 A 4 4 0 0 0 30 24 A 4 4 0 0 0 30 32 H 40" />
                <line x1="22" y1="12" x2="22" y2="36" />
                <line x1="26" y1="12" x2="26" y2="36" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Transformer</span>
          </div>

          {/* D Flip-Flop */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'dff')} draggable
          >
            <div className="p-1.5 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-indigo-600 dark:text-indigo-400">
              <div className="border border-indigo-300 dark:border-indigo-700 rounded px-1.5 py-0.5 text-[8px] font-bold">DFF</div>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">D Flip-Flop</span>
          </div>

          {/* LDR */}
          <div 
            className={itemClass}
            onDragStart={(e) => onDragStart(e, 'ldr')} draggable
          >
            <div className="p-1.5 bg-rose-50 dark:bg-rose-950/30 rounded-lg mb-1 group-hover:scale-105 transition-transform text-rose-600 dark:text-rose-400">
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="24" cy="24" r="12" />
                <path d="M 14 24 L 17 20 L 21 28 L 25 20 L 29 28 L 31 20 L 34 24" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">LDR</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
