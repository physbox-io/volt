import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AccountMenu, useAccountSession, type AccountSignIn } from '@physbox-io/ui';
import { clearStoredAuth, fetchCurrentUser, getStoredUser, loginWithGoogle } from '../utils/apiClient';
import { disableGoogleAutoSelect, isGoogleSignInConfigured, renderGoogleSignInButton } from '../utils/googleAuth';
import { pullCloudState } from '../utils/cloudSync';
import { RemoteMachiningModal } from './RemoteMachiningModal';
import { JobHistoryModal } from './JobHistoryModal';
import { CloudSaveStatus } from './CloudSaveStatus';
import { GuestListModal } from './GuestListModal';

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
      <RemoteMachiningModal isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />
      <JobHistoryModal isOpen={showHistoryModal} onClose={() => setShowHistoryModal(false)} />
      {/* Mounted here because this component is always on screen; it paints itself through a portal. */}
      <CloudSaveStatus />
      <GuestListModal isOpen={showGuestModal} onClose={() => setShowGuestModal(false)} userEmail={user?.email || ''} />
    </AccountMenu>
  );
};
