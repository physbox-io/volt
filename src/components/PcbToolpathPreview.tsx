import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Clock, Move, Scissors, ShieldCheck } from 'lucide-react';
import type { PcbLayoutResult, PcbOptions } from '../utils/pcbExporter';
import type { ProbeGrid } from '../utils/meshLeveler';

export interface PcbToolpathPreviewProps {
  result: PcbLayoutResult;
  options: PcbOptions;
  heightmap?: ProbeGrid | null;
  isAirCut?: boolean;
  airCutZOffset?: number;
  /**
   * Fraction of the job the machine has actually streamed, 0..1, or null when
   * no job is running. While it is set the preview follows the machine instead
   * of the scrubber — the same view, driven live rather than by playback.
   */
  liveProgress?: number | null;
}

export const PcbToolpathPreview: React.FC<PcbToolpathPreviewProps> = ({
  result,
  options,
  heightmap,
  isAirCut = false,
  airCutZOffset = 20,
  liveProgress = null,
}) => {
  const [wantsPlayback, setWantsPlayback] = useState(false);
  const [scrubProgress, setScrubProgress] = useState(1.0); // 0.0 to 1.0

  const isLive = liveProgress !== null && Number.isFinite(liveProgress);
  // The machine wins while a job is on the wire. Clamped because a job whose
  // streamed line count drifts from the parsed move count could otherwise push
  // the toolhead marker off the end of the path.
  const progress = isLive ? Math.min(1, Math.max(0, liveProgress as number)) : scrubProgress;
  // Derived rather than reset in an effect: a job starting has to suppress
  // playback immediately, and an effect would let one frame of the animation
  // fight the machine for the same view first.
  const playing = wantsPlayback && !isLive;
  const setPlaying = setWantsPlayback;
  const setProgress = setScrubProgress;
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);

  // Layer Visibility state
  const [showIsolation, setShowIsolation] = useState(true);
  const [showDrills, setShowDrills] = useState(true);
  const [showProfile, setShowProfile] = useState(true);
  const [showRapids, setShowRapids] = useState(true);
  const [showHeightmap, setShowHeightmap] = useState(true);

  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // Parse G-code moves into visual segments for playback and metric inspection
  const parsedMoves = useMemo(() => {
    if (!result.gcode) return [];
    const lines = result.gcode.split('\n');
    const moves: {
      type: 'G0' | 'G1';
      x0: number;
      y0: number;
      z0: number;
      x1: number;
      y1: number;
      z1: number;
      op: 'isolation' | 'drill' | 'profile' | 'unknown';
    }[] = [];

    let curX = 0, curY = 0, curZ = options.safeZ;
    let currentOp: 'isolation' | 'drill' | 'profile' | 'unknown' = 'isolation';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.includes('OP 1/3') || trimmed.includes('Isolation')) currentOp = 'isolation';
      if (trimmed.includes('OP 2/3') || trimmed.includes('drilling')) currentOp = 'drill';
      if (trimmed.includes('OP 3/3') || trimmed.includes('profile')) currentOp = 'profile';

      if (trimmed.startsWith(';')) continue;
      const parts = trimmed.toUpperCase().split(/\s+/);
      const cmd = parts[0];

      if (cmd === 'G0' || cmd === 'G1') {
        let tX = curX, tY = curY, tZ = curZ;
        for (const p of parts.slice(1)) {
          if (p.startsWith('X')) tX = parseFloat(p.slice(1)) ?? tX;
          if (p.startsWith('Y')) tY = parseFloat(p.slice(1)) ?? tY;
          if (p.startsWith('Z')) tZ = parseFloat(p.slice(1)) ?? tZ;
        }

        if (Math.hypot(tX - curX, tY - curY, tZ - curZ) > 0.0001) {
          moves.push({
            type: cmd,
            x0: curX,
            y0: curY,
            z0: curZ,
            x1: tX,
            y1: tY,
            z1: tZ,
            op: currentOp,
          });
        }
        curX = tX;
        curY = tY;
        curZ = tZ;
      }
    }
    return moves;
  }, [result.gcode, options.safeZ]);

  const totalMoveCount = parsedMoves.length;
  const currentMoveIdx = Math.min(
    totalMoveCount - 1,
    Math.floor(progress * totalMoveCount)
  );

  // Toolhead cursor position
  const activeToolhead = useMemo(() => {
    if (parsedMoves.length === 0) return { x: 0, y: 0, z: options.safeZ };
    if (currentMoveIdx < 0) return { x: parsedMoves[0].x0, y: parsedMoves[0].y0, z: parsedMoves[0].z0 };
    const move = parsedMoves[currentMoveIdx];
    return { x: move.x1, y: move.y1, z: move.z1 };
  }, [parsedMoves, currentMoveIdx, options.safeZ]);

  // Animation Loop
  useEffect(() => {
    if (!playing) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lastTimeRef.current = null;
      return;
    }

    const animate = (now: number) => {
      if (lastTimeRef.current !== null) {
        const delta = (now - lastTimeRef.current) / 1000; // seconds
        // Loop standard run over ~10 seconds
        const step = (delta / 10) * speed;
        setScrubProgress(prev => {
          if (prev + step >= 1.0) {
            setWantsPlayback(false);
            return 1.0;
          }
          return prev + step;
        });
      }
      lastTimeRef.current = now;
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [playing, speed]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const visibleMoves = useMemo(() => {
    return parsedMoves.slice(0, currentMoveIdx + 1);
  }, [parsedMoves, currentMoveIdx]);

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden text-xs">
      {/* Header controls & Layer Toggles */}
      <div className="p-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPlaying(!playing)}
            disabled={isLive}
            className="p-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded cursor-pointer flex items-center gap-1 font-medium"
            title={isLive ? 'Following the running job' : playing ? 'Pause Playback' : 'Play Toolpath Animation'}
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{playing ? 'Pause' : 'Play'}</span>
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setProgress(0);
            }}
            disabled={isLive}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded cursor-pointer"
            title="Reset Timeline"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center bg-slate-800 rounded p-0.5 text-[10px] text-slate-300 ml-1">
            {[1, 2, 5].map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s as 1 | 2 | 5)}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  speed === s ? 'bg-emerald-500 text-white font-bold' : 'hover:text-white'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Operation Layer Toggles */}
        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-300">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showIsolation}
              onChange={e => setShowIsolation(e.target.checked)}
              className="accent-cyan-400"
            />
            <span className="text-cyan-400">Isolation</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showDrills}
              onChange={e => setShowDrills(e.target.checked)}
              className="accent-amber-400"
            />
            <span className="text-amber-400">Drills</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showProfile}
              onChange={e => setShowProfile(e.target.checked)}
              className="accent-fuchsia-400"
            />
            <span className="text-fuchsia-400">Profile</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showRapids}
              onChange={e => setShowRapids(e.target.checked)}
              className="accent-yellow-400"
            />
            <span className="text-yellow-400">Rapids</span>
          </label>
          {heightmap && (
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showHeightmap}
                onChange={e => setShowHeightmap(e.target.checked)}
                className="accent-emerald-400"
              />
              <span className="text-emerald-400">Probed Mesh</span>
            </label>
          )}
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div className="relative flex-1 bg-slate-950 p-2 min-h-[220px] flex items-center justify-center overflow-hidden">
        {isAirCut && (
          <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-amber-500/20 border border-amber-500/40 rounded text-amber-300 font-mono text-[10px] flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-amber-400" />
            AIR CUT DRY RUN (+{airCutZOffset}mm Z-Offset Active)
          </div>
        )}

        <svg
          viewBox={`-5 -5 ${result.boardWidthMm + 10} ${result.boardHeightMm + 10}`}
          className="w-full h-full max-h-[300px] select-none"
        >
          {/* Grid background */}
          <rect
            x="0"
            y="0"
            width={result.boardWidthMm}
            height={result.boardHeightMm}
            fill="#0f172a"
            stroke="#334155"
            strokeWidth="0.3"
            rx="1"
          />

          {/* Render Probed Heightmap Grid Overlay */}
          {heightmap && showHeightmap && (
            <g opacity="0.4">
              {heightmap.points.map((row, rIdx) =>
                row.map((pt, cIdx) => (
                  <g key={`hm_${rIdx}_${cIdx}`}>
                    <circle cx={pt.x} cy={pt.y} r="0.8" fill={pt.z >= 0 ? '#10b981' : '#f59e0b'} />
                    {cIdx + 1 < row.length && (
                      <line
                        x1={pt.x}
                        y1={pt.y}
                        x2={row[cIdx + 1].x}
                        y2={row[cIdx + 1].y}
                        stroke="#10b981"
                        strokeWidth="0.15"
                        strokeDasharray="0.5 0.5"
                      />
                    )}
                    {rIdx + 1 < heightmap.points.length && (
                      <line
                        x1={pt.x}
                        y1={pt.y}
                        x2={heightmap.points[rIdx + 1][cIdx].x}
                        y2={heightmap.points[rIdx + 1][cIdx].y}
                        stroke="#10b981"
                        strokeWidth="0.15"
                        strokeDasharray="0.5 0.5"
                      />
                    )}
                  </g>
                ))
              )}
            </g>
          )}

          {/* Copper Traces Background */}
          {result.traces.map((t, idx) => (
            <polyline
              key={`tr_${idx}`}
              points={t.points.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#059669"
              strokeWidth={t.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.3"
            />
          ))}

          {/* Animated Motion Moves */}
          {visibleMoves.map((m, idx) => {
            if (m.type === 'G0' && !showRapids) return null;
            if (m.op === 'isolation' && !showIsolation) return null;
            if (m.op === 'drill' && !showDrills) return null;
            if (m.op === 'profile' && !showProfile) return null;

            const isRapid = m.type === 'G0';
            const color = isRapid
              ? '#eab308' // Yellow rapid
              : m.op === 'isolation'
              ? '#06b6d4' // Cyan isolation
              : m.op === 'drill'
              ? '#f97316' // Orange drill
              : '#d946ef'; // Fuchsia profile

            return (
              <line
                key={`m_${idx}`}
                x1={m.x0}
                y1={m.y0}
                x2={m.x1}
                y2={m.y1}
                stroke={color}
                strokeWidth={isRapid ? '0.12' : '0.25'}
                strokeDasharray={isRapid ? '0.4 0.4' : undefined}
                opacity={idx === visibleMoves.length - 1 ? 1.0 : 0.75}
              />
            );
          })}

          {/* Drill Holes Markers */}
          {showDrills &&
            result.drills.map((d, idx) => (
              <circle
                key={`dr_${idx}`}
                cx={d.x}
                cy={d.y}
                r={d.diameter / 2}
                fill="#f97316"
                opacity="0.6"
              />
            ))}

          {/* Toolhead Cursor Position */}
          <g transform={`translate(${activeToolhead.x}, ${activeToolhead.y})`}>
            <circle r="1.2" fill="none" stroke="#ef4444" strokeWidth="0.3" />
            <circle r="0.3" fill="#ef4444" />
            <line x1="-2" y1="0" x2="2" y2="0" stroke="#ef4444" strokeWidth="0.15" />
            <line x1="0" y1="-2" x2="0" y2="2" stroke="#ef4444" strokeWidth="0.15" />
          </g>
        </svg>
      </div>

      {/* Scrubber Bar & Telemetry Footer */}
      <div className="p-2.5 bg-slate-900 border-t border-slate-800 space-y-2">
        <div className="flex items-center gap-2 text-slate-300 font-mono text-[10px]">
          {isLive ? (
            <span className="flex items-center gap-1 text-red-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          ) : (
            <span>0%</span>
          )}
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={progress}
            disabled={isLive}
            onChange={e => setProgress(parseFloat(e.target.value))}
            className={`flex-1 h-1.5 bg-slate-800 rounded ${
              isLive ? 'accent-red-500 cursor-not-allowed' : 'accent-emerald-500 cursor-pointer'
            }`}
          />
          <span>{Math.round(progress * 100)}%</span>
        </div>

        <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-emerald-400">
              <Clock className="w-3.5 h-3.5" />
              Est. Time: {formatTime(result.cycleTimeSec || 0)}
            </span>
            <span className="flex items-center gap-1 text-slate-300">
              <Scissors className="w-3.5 h-3.5 text-cyan-400" />
              Cut: {result.cutDistanceMm || 0}mm
            </span>
            <span className="flex items-center gap-1 text-slate-300">
              <Move className="w-3.5 h-3.5 text-yellow-400" />
              Rapid: {result.travelDistanceMm || 0}mm
            </span>
          </div>

          <div className="flex items-center gap-2 text-slate-300">
            <span>Pos: X{activeToolhead.x.toFixed(2)} Y{activeToolhead.y.toFixed(2)} Z{activeToolhead.z.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
