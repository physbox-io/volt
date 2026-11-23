/**
 * Volt's cloud autosave: the shared engine (`@physbox-io/ui/cloud`), given
 * Volt's API client and the storage keys this browser has always used for it.
 *
 * The engine — debouncing, conflicts, the unsaved-work offer, never writing a
 * document nobody touched — lives in the ui package, because Etch, Volt and
 * Mesh each had a copy and fixes had to be made three times.
 */

import { createCloudAutosave } from '@physbox-io/ui/cloud';
import {
  isProAccount,
  isProRequired,
  getStoredAuthToken,
  putCloudDocument,
  fetchCloudDocument,
  deleteCloudDocument,
} from './apiClient';

export type { AutosaveState, AutosaveStatus, CloudDraft } from '@physbox-io/ui/cloud';

export const cloudAutosave = createCloudAutosave({
  appId: 'circuit',
  storagePrefix: 'circuit',
  api: { isProAccount, isProRequired, getStoredAuthToken, putCloudDocument, fetchCloudDocument, deleteCloudDocument },
});
