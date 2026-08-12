import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Sparkles, CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react';

interface GuestListModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
}

export const GuestListModal: React.FC<GuestListModalProps> = ({ isOpen, onClose, userEmail }) => {
  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[99999] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-emerald-500/30 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl text-slate-100 p-6 text-center relative my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
          <Sparkles className="w-3.5 h-3.5" /> Early Access VIP Guest List
        </div>

        <h2 className="text-2xl font-extrabold text-slate-100 mb-2">
          You're on the Guest List!
        </h2>

        <p className="text-sm text-slate-300 leading-relaxed mb-5">
          Thank you for joining PhysBox Cloud! Your account is registered for early access. We are activating accounts in batches to maintain real-time telemetry performance.
        </p>

        {userEmail && (
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs text-emerald-300 font-mono flex items-center justify-center gap-2 mb-6">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{userEmail}</span>
          </div>
        )}

        <div className="space-y-2.5 text-left bg-slate-950/40 p-4 rounded-xl border border-slate-800 text-xs text-slate-300 mb-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Auto-save and parameter sync configured</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Remote machining telemetry dashboard enabled</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>You will receive an activation email once batch opens</span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold py-2.5 px-4 rounded-xl transition shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 text-sm cursor-pointer"
        >
          <span>Continue Exploring PhysBox</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>,
    document.body
  );
};
