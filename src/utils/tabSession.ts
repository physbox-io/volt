/**
 * This tab's identity: made once per tab, kept across reloads, gone with the tab.
 *
 * sessionStorage is the store because it has exactly that lifetime. The MCP
 * bridge offers it as the tab's session id, and the job checkpoint signs its
 * progress records with it, so a second tab can tell a job another tab is
 * still streaming from one a reload of this tab left behind.
 */

const TAB_SESSION_KEY = 'physbox_tab_session';

/** Held for the page's life too, so a tab without sessionStorage keeps one id. */
let cached: { id: string; startedAt: number } | null = null;

export function tabSession(): { id: string; startedAt: number } {
  if (cached) return cached;
  let id = '';
  let startedAt = Date.now();
  try {
    const stored = sessionStorage.getItem(TAB_SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { id?: string; startedAt?: number };
      if (typeof parsed.id === 'string') id = parsed.id;
      if (typeof parsed.startedAt === 'number') startedAt = parsed.startedAt;
    }
  } catch { /* private mode, or a value we did not write: fall through and make one */ }
  if (!id) {
    id = `tab_${Math.random().toString(36).slice(2, 10)}`;
    try { sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify({ id, startedAt })); } catch { /* nothing to do */ }
  }
  cached = { id, startedAt };
  return cached;
}
