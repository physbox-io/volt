import { useEffect } from 'react';
import { cloudAutosave } from '../utils/cloudDocuments';

/**
 * Closing or reloading the tab with unsaved work asks first. The canvas is
 * not kept anywhere locally, so a reload into the default circuit loses it.
 * Not when the account's autosave already holds the latest circuit.
 *
 * Off under the dev server, whose own full reloads after an edit would stop on
 * the question every time. Unbound when App unmounts, so the crash page's
 * Reload does not ask again about what it has just offered to save.
 */
export function useUnsavedWorkPrompt(hasUnsavedWork: () => boolean) {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedWork() || cloudAutosave.holdsLatest()) return;
      e.preventDefault();
      // Older Chromium and Safari still want the legacy field set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedWork]);
}
