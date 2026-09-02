import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { User, LogOut, Radio, Sparkles, ShieldCheck, CheckCircle } from 'lucide-react';
import { getStoredUser, clearStoredAuth, loginWithGoogle, fetchCurrentUser } from '../utils/apiClient';
import { renderGoogleSignInButton, disableGoogleAutoSelect } from '../utils/googleAuth';
import type { PhysBoxUser } from '../utils/apiClient';
import { RemoteMachiningModal } from './RemoteMachiningModal';
import { GuestListModal } from './GuestListModal';
import { restoreLlmSettingsFromCloud } from '../utils/llmSettings';

export const UserProfileButton: React.FC = () => {
  const [user, setUser] = useState<PhysBoxUser | null>(getStoredUser());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCurrentUser().then((u) => {
      if (!u) return;
      setUser(u);
      // Copilot keys live under the account's `global` namespace, shared with
      // the other Physbox apps; pull down anything this browser is missing.
      void restoreLlmSettingsFromCloud();
    });
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCredential = React.useCallback(async (credential: string) => {
    setIsLoading(true);
    setLoginError(null);
    try {
      const res = await loginWithGoogle({ credential });
      setUser(res.user);
      void restoreLlmSettingsFromCloud();
      setShowLoginModal(false);
      setDropdownOpen(false);
      if (!res.is_admin) {
        setShowGuestModal(true);
      }
    } catch (err: any) {
      console.error('Sign in failed:', err);
      setLoginError(err?.message || 'Sign in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /*
   * Google's button is drawn once the modal is on screen, not before: it needs
   * a mounted container to render into.
   */
  useEffect(() => {
    if (!showLoginModal || !googleButtonRef.current) return;
    let cancelled = false;
    renderGoogleSignInButton(
      googleButtonRef.current,
      (credential) => {
        if (!cancelled) void handleCredential(credential);
      },
      (message) => {
        if (!cancelled) setLoginError(message);
      }
    ).catch((err) => {
      if (!cancelled) {
        setLoginError(err instanceof Error ? err.message : 'Could not load Google sign-in.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showLoginModal, handleCredential]);

  const handleLogout = () => {
    clearStoredAuth();
    // Otherwise Google hands the same account straight back next time, and
    // signing out looks like it did nothing.
    disableGoogleAutoSelect();
    setUser(null);
    setDropdownOpen(false);
  };

  const isActiveSub = user?.subscription_tier === 'active';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="relative flex items-center justify-center w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs"
        title={user ? `Account (${user.email})` : 'Sign In / Early Access'}
      >
        {user?.picture ? (
          <img src={user.picture} alt="Avatar" className="w-5 h-5 rounded-full" />
        ) : (
          <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        )}
        <span
          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
            user ? (isActiveSub ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-slate-400'
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 p-3 space-y-3 text-slate-800 dark:text-slate-100">
          {user ? (
            <>
              {/* Logged-In Profile Header */}
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  {user.picture ? (
                    <img src={user.picture} alt="Avatar" className="w-8 h-8 rounded-full border border-emerald-500/30" />
                  ) : (
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                  <div className="overflow-hidden">
                    <p className="font-bold text-slate-800 dark:text-slate-100 text-xs truncate">{user.name || 'PhysBox Member'}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Subscription Status</span>
                  {isActiveSub ? (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30"
                    >
                      <ShieldCheck className="w-3 h-3" /> Active Subscription
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        setShowGuestModal(true);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" /> On the Guest List 🎉
                    </button>
                  )}
                </div>
              </div>

              {/* Navigation Options */}
              <div className="space-y-1">
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    setShowRemoteModal(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  <Radio className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>View Remote Machining Telemetry</span>
                </button>

                <div className="px-3 py-1.5 text-[10px] text-slate-500 flex items-center gap-1.5">
                  <CheckCircle className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                  <span>Cloud Parameter & Preset Auto-Sync Active</span>
                </div>
              </div>

              {/* Logout Button */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </>
          ) : (
            /* Logged-Out Menu */
            <div className="space-y-3 p-1">
              <div className="text-center">
                <p className="font-bold text-slate-800 dark:text-slate-100 text-xs">PhysBox Account Sign In</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Sign in to synchronize parameters, saved presets, and remote telemetry.</p>
              </div>

              <button
                onClick={() => {
                  setDropdownOpen(false);
                  setShowLoginModal(true);
                }}
                className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                <User className="w-4 h-4" />
                <span>Sign In / Early Access</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Login Modal */}
      {showLoginModal &&
        ReactDOM.createPortal(
          <div
            className="fixed inset-0 z-[99999] bg-slate-900/50 dark:bg-black/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
            onClick={() => setShowLoginModal(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl relative max-h-[90vh] overflow-y-auto my-auto text-slate-800 dark:text-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowLoginModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                title="Close (Esc)"
              >
                ✕
              </button>
              <div className="text-center space-y-1">
                <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">PhysBox Account Sign In</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Enter your email address to sign in with Google or join the early access guest list.</p>
              </div>
              {loginError && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs text-center">
                  {loginError}
                </div>
              )}
              {/* Google draws its own button here. The email textbox this
                  replaces sent a typed address to the API and got a session
                  back — nothing about it involved Google, and nothing
                  established that the person typing owned the address. The API
                  now rejects that outright, so this form could not sign anyone
                  in at all: it failed quietly, and the machines list stayed
                  empty because nobody was ever signed in. */}
              <div className="flex justify-center pt-1">
                <div ref={googleButtonRef} />
              </div>
              {isLoading && (
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">Signing in…</p>
              )}
            </div>
          </div>,
          document.body
        )}

      <RemoteMachiningModal isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />
      <GuestListModal
        isOpen={showGuestModal}
        onClose={() => setShowGuestModal(false)}
        userEmail={user?.email || ''}
      />
    </div>
  );
};
