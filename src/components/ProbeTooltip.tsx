import { useState, useEffect } from 'react';
import { playbackTicker, findIndexForTime } from '../utils/playbackTicker';

export function ProbeTooltip({ probeData, isSimulating, onClose }: { probeData: any; isSimulating: boolean; onClose: () => void }) {
  const [currentVoltage, setCurrentVoltage] = useState(probeData.voltage);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  useEffect(() => {
    if (!probeData.history || !probeData.timePoints || probeData.history.length === 0) {
      setCurrentVoltage(probeData.voltage);
      setCurrentTimeMs(0);
      return;
    }

    if (!isSimulating) {
      setCurrentTimeMs(0);
      setCurrentVoltage(probeData.history[probeData.history.length - 1] ?? 0);
      return;
    }

    const times = probeData.timePoints;

    const unsubscribe = playbackTicker.subscribe((elapsedMs) => {
      setCurrentTimeMs(elapsedMs);
      const idx = findIndexForTime(times, elapsedMs);
      setCurrentVoltage(probeData.history[idx] ?? 0);
    });

    return unsubscribe;
  }, [probeData, isSimulating]);

  return (
    <div
      className="fixed z-[200] bg-slate-950/95 backdrop-blur-md text-white rounded-xl px-4 py-3 shadow-2xl border border-violet-500/40 text-xs font-mono pointer-events-auto animate-in fade-in duration-100 flex flex-col gap-2 min-w-[220px]"
      style={{ left: probeData.x + 12, top: probeData.y - 10 }}
      onClick={onClose}
    >
      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 gap-4">
        <span className="text-violet-300 font-bold">🔍 Probe</span>
        <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">Net: {probeData.netName}</span>
      </div>
      
      <div className="flex justify-between items-baseline gap-4 mt-0.5">
        <div className="text-slate-400 text-[10px]">Value:</div>
        <div className="text-base font-bold text-green-400">{currentVoltage.toFixed(4)} V</div>
      </div>

      {probeData.history && probeData.history.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-1 text-[9px] text-slate-400 border-t border-slate-800/50 pt-1.5 mt-0.5">
            <div>Max: <span className="text-red-400">{probeData.maxV?.toFixed(2)}V</span></div>
            <div>Min: <span className="text-emerald-400">{probeData.minV?.toFixed(2)}V</span></div>
            <div>Avg: <span className="text-amber-400">{probeData.avgV?.toFixed(2)}V</span></div>
          </div>

          <div className="h-10 w-full bg-slate-900/60 rounded-lg p-1 border border-slate-800/30 overflow-hidden flex items-center justify-center mt-1 relative">
            {/* Sparkline */}
            {(() => {
              const pts = probeData.history || [];
              const min = probeData.minV ?? 0;
              const max = probeData.maxV ?? 0;
              const range = max - min;
              
              // Downsample
              const maxPoints = 80;
              let displayPts = pts;
              if (pts.length > maxPoints) {
                const factor = Math.ceil(pts.length / maxPoints);
                displayPts = pts.filter((_, i) => i % factor === 0);
              }
              
              if (displayPts.length === 0) return null;
              
              const width = 180;
              const height = 32;
              const padding = 2;
              
              const pointsString = displayPts.map((v, i) => {
                const x = padding + (i / (displayPts.length - 1)) * (width - 2 * padding);
                const y = range === 0 
                  ? height / 2 
                  : height - padding - ((v - min) / range) * (height - 2 * padding);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');

              // Calculate playhead x-coordinate
              const times = probeData.timePoints || [0, 1000];
              const duration = times[times.length - 1] || 1000;
              const playheadRatio = duration > 0 ? currentTimeMs / duration : 0;
              const playheadX = padding + playheadRatio * (width - 2 * padding);

              return (
                <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
                  <defs>
                    <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  {/* Area under curve */}
                  {range > 0 && (
                    <polygon
                      points={`${padding},${height - padding} ${pointsString} ${width - padding},${height - padding}`}
                      fill="url(#sparkline-grad)"
                    />
                  )}
                  {/* Sparkline path */}
                  <polyline
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={pointsString}
                  />
                  {/* Playhead line */}
                  <line 
                    x1={playheadX} 
                    y1={padding} 
                    x2={playheadX} 
                    y2={height - padding} 
                    stroke="#ef4444" 
                    strokeWidth="1.5" 
                    strokeDasharray="1 1"
                  />
                </svg>
              );
            })()}
          </div>
        </>
      )}
      <div className="text-[9px] text-slate-500 mt-1 text-center italic border-t border-slate-800/30 pt-1">click to dismiss</div>
    </div>
  );
}
