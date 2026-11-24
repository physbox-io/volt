import React, { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import { AccountMenu, CloudSaveStatus, useAccountSession, type AccountSignIn } from '@physbox-io/ui';
import { clearStoredAuth, fetchCurrentUser, getStoredUser, loginWithGoogle } from '../utils/apiClient';
import { disableGoogleAutoSelect, isGoogleSignInConfigured, renderGoogleSignInButton } from '../utils/googleAuth';
import { pullCloudState } from '../utils/cloudSync';
import { cloudAutosave } from '../utils/cloudDocuments';

const RemoteMachiningModal = lazy(() =>
  import('./RemoteMachiningModal').then(m => ({ default: m.RemoteMachiningModal }))
);
const JobHistoryModal = lazy(() =>
  import('./JobHistoryModal').then(m => ({ default: m.JobHistoryModal }))
);
const GuestListModal = lazy(() =>
  import('./GuestListModal').then(m => ({ default: m.GuestListModal }))
);

export const UserProfileButton: React.FC = () => {
  const { user, sync, refresh } = useAccountSession({
    storedUser: getStoredUser,
    fetchUser: fetchCurrentUser,
    pull: pullCloudState,
    workNoun: 'circuits',
  });
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const isAdmin = useRef(false);

  const signIn = useMemo<AccountSignIn>(
    () => ({
      kind: 'google-button',
      configured: isGoogleSignInConfigured(),
      render: renderGoogleSignInButton,
      exchange: async (credential) => {
        isAdmin.current = (await loginWithGoogle(credential)).is_admin;
      },
    }),
    []
  );

  /*
   * The guest-list window says access is activated in batches, the opposite of
   * what just happened to somebody sent here to share: skip it when something
   * asked for the sign-in.
   */
  const onSignedIn = useCallback(
    async (reason: string | null) => {
      if (!reason && !isAdmin.current) setShowGuestModal(true);
      await refresh();
    },
    [refresh]
  );

  const onSignOut = useCallback(() => {
    clearStoredAuth();
    // Otherwise Google hands the same account straight back next time.
    disableGoogleAutoSelect();
    void refresh();
  }, [refresh]);

  return (
    <AccountMenu
      user={user}
      accent="emerald"
      workNoun="circuits"
      sync={sync}
      signIn={signIn}
      onSignedIn={onSignedIn}
      onSignOut={onSignOut}
      onOpenRemote={() => setShowRemoteModal(true)}
      onOpenHistory={() => setShowHistoryModal(true)}
      onOpenGuestList={() => setShowGuestModal(true)}
    >
      <Suspense fallback={null}>
        {showRemoteModal && (
          <RemoteMachiningModal isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />
        )}
        {showHistoryModal && (
          <JobHistoryModal isOpen={showHistoryModal} onClose={() => setShowHistoryModal(false)} />
        )}
        {showGuestModal && (
          <GuestListModal
            isOpen={showGuestModal}
            onClose={() => setShowGuestModal(false)}
            userEmail={user?.email || ''}
          />
        )}
      </Suspense>
      {/* Mounted here because this component is always on screen; it paints itself through a portal. */}
      <CloudSaveStatus autosave={cloudAutosave} accentClassName="bg-emerald-600 hover:bg-emerald-500" />
    </AccountMenu>
  );
};
