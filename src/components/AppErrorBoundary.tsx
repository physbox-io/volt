// ---------------------------------------------------------------------------
// The last thing standing when the app throws while rendering
// ---------------------------------------------------------------------------
//
// Without this, one exception in any component unmounted the whole tree and
// left a blank page; the only way out was a reload, and a reload starts from
// the default circuit. The canvas is App's state, so it goes with App — but a
// copy of it is kept outside the tree (see utils/circuitFile), and this page
// offers to save that before it offers the reload.
// ---------------------------------------------------------------------------

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { downloadOpenCircuit } from '../utils/circuitFile';

function isDark(): boolean {
  try {
    return localStorage.getItem('circuit_dark_mode') === 'true';
  } catch {
    return false;
  }
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; saveFailed: boolean }> {
  state = { error: null as Error | null, saveFailed: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Volt stopped on a render error', error, info.componentStack);
  }

  private save = () => {
    try {
      if (!downloadOpenCircuit()) this.setState({ saveFailed: true });
    } catch (e) {
      console.error('Could not save the circuit after a crash', e);
      this.setState({ saveFailed: true });
    }
  };

  render() {
    const { error, saveFailed } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={`${isDark() ? 'dark' : ''} h-dvh w-screen`}>
        <div className="h-full w-full flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
          <div className="max-w-md w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400">
                <AlertTriangle size={20} />
              </div>
              <h1 className="text-lg font-semibold">Volt hit an error</h1>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">
              Your circuit is still here. Save a copy before reloading; you can open it again with Import JSON.
            </p>
            <pre className="text-xs whitespace-pre-wrap break-words max-h-32 overflow-auto rounded-lg bg-slate-100 dark:bg-slate-800 p-2 mb-4 text-slate-700 dark:text-slate-300">
              {error.message || String(error)}
            </pre>
            {saveFailed && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-3">The circuit could not be saved either.</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={this.save}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white"
              >
                Save circuit
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
