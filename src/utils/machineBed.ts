import {
  CNC_BED_PARAMETER,
  CNC_BED_STORAGE_KEY,
  CncBedStore,
  type CncBed,
} from '@physbox-io/machining';
import { syncCloudParameters } from './apiClient';

/**
 * The machine's working envelope, shared with Etch and Mesh through the
 * account. The machine reads it (see webSerialManager.ts), so the travel check
 * has the owner's figure wherever the controller has not reported its own.
 */
export const machineBedStore = new CncBedStore({
  load: () => {
    try {
      return localStorage.getItem(CNC_BED_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  save: (text) => {
    try {
      localStorage.setItem(CNC_BED_STORAGE_KEY, text);
      return true;
    } catch {
      return false;
    }
  },
  push: (bed) => void syncCloudParameters('global', { [CNC_BED_PARAMETER]: bed as unknown as Record<string, unknown> }),
});

export type { CncBed };
