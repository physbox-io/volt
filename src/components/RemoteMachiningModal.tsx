import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { X, Radio, Clock, AlertTriangle, RefreshCw, Cpu, Star } from 'lucide-react';
import { fetchLatestTelemetry, isProAccount } from '../utils/apiClient';
import type { MachiningTelemetry } from '../utils/apiClient';

interface RemoteMachiningModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RemoteMachiningModal: React.FC<RemoteMachiningModalProps> = ({ isOpen, onClose }) => {
  const [telemetry, setTelemetry] = useState<MachiningTelemetry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchLatestTelemetry();
      setTelemetry(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      const interval = setInterval(loadData, 3000);
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        clearInterval(interval);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[99999] bg-slate-900/50 dark:bg-black/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl my-auto overflow-hidden text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                Remote Machining Telemetry
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Live CNC status synchronized across devices via api.physbox.io</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {/* Watching a job from another device is the account layer's whole point,
              so it is Pro. Free accounts get told what it does rather than an empty
              panel that looks like a machine failing to report. */}
          {!isProAccount() ? (
            <div className="text-center py-10 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-200 dark:border-slate-800 px-6">
              <Star className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <p className="text-slate-700 dark:text-slate-300 font-medium">Remote monitoring is part of PhysBox Pro</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                Driving your machine from this browser works exactly as it does now. Pro adds
                watching it from somewhere else &mdash; progress, position, feed and faults on your
                phone while a four-hour job runs &mdash; and keeps every finished run afterwards.
              </p>
              <a
                href="https://physbox.io/pro.html"
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs"
              >
                See PhysBox Pro
              </a>
            </div>
          ) : telemetry.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-200 dark:border-slate-800">
              <Cpu className="w-12 h-12 text-slate-400 dark:text-slate-600 mx-auto mb-3 opacity-60" />
              <p className="text-slate-700 dark:text-slate-300 font-medium">No Active Remote Telemetry</p>
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1 max-w-md mx-auto">
                Connect a machine via WebSerial on any device to stream real-time cut status, Z-height, line progress, and spindle metrics here.
              </p>
            </div>
          ) : (
            telemetry.map((item, idx) => {
              const isRunning = item.status === 'running' || item.status === 'Run';
              const progress = Math.min(100, Math.max(0, item.progressPercent || 0));

              return (
                <div key={idx} className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-100 text-base">{item.jobName || 'Machining Job'}</span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                          isRunning ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Device ID: <code className="text-emerald-600 dark:text-emerald-300">{item.deviceId || 'Primary CNC'}</code></p>
                    </div>
                    <div className="text-right text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString() : 'Just now'}</span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <span>Progress ({progress.toFixed(1)}%)</span>
                      <span>Line {item.currentLine || 0} / {item.totalLines || 0}</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
                    <div className="bg-white dark:bg-slate-900/80 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-500 dark:text-slate-400 block mb-0.5">XYZ Position (mm)</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-300 font-semibold">
                        X:{item.xyz?.x?.toFixed(1) ?? '0.0'} Y:{item.xyz?.y?.toFixed(1) ?? '0.0'} Z:{item.xyz?.z?.toFixed(2) ?? '0.00'}
                      </span>
                    </div>
                    <div className="bg-white dark:bg-slate-900/80 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-500 dark:text-slate-400 block mb-0.5">Spindle Speed</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-300 font-semibold">{item.spindleSpeed || 0} RPM</span>
                    </div>
                    <div className="bg-white dark:bg-slate-900/80 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-500 dark:text-slate-400 block mb-0.5">Feed Rate</span>
                      <span className="font-mono text-cyan-600 dark:text-cyan-300 font-semibold">{item.feedRate || 0} mm/min</span>
                    </div>
                  </div>

                  {item.lastError && (
                    <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs p-3 rounded-lg flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{item.lastError}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 shrink-0 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
