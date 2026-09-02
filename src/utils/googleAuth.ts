/**
 * Real Google sign-in, via Google Identity Services.
 *
 * The sign-in form here used to be an email textbox next to a button labelled
 * "Sign In with Google", which sent that typed address to the API and got a
 * session back. Nothing about it involved Google, and nothing established that
 * the person typing owned the address. This module fetches an actual Google ID
 * token — signed by Google, minted for this specific client id — which is the
 * only thing the API will now accept.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon';
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'small' | 'medium' | 'large';
      text?: 'signin_with' | 'signup_with' | 'continue_with';
      shape?: 'rectangular' | 'pill' | 'circle' | 'square';
      logo_alignment?: 'left' | 'center';
      width?: number;
    }
  ): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

/**
 * The OAuth Web client id for `etch.physbox.io`.
 *
 * Deliberately committed to source rather than kept in a `.env`. It is public
 * by construction — Vite substitutes it into the shipped JavaScript, so anyone
 * can read it out of the bundle — and it *identifies* the application rather
 * than authenticating it; the security comes from the authorised-origins list
 * on the Google side and from the API verifying the audience on every
 * credential. Holding it here means a fresh checkout builds a working sign-in
 * with no untracked setup step, and leaves `.env` gitignored and free for
 * things that genuinely are secret.
 *
 * It must stay identical to the `GOOGLE_CLIENT_ID` the API runs with. If the
 * two ever drift, every sign-in fails as a wrong-audience error.
 */
const DEFAULT_GOOGLE_CLIENT_ID = '454740079598-5kjau5ikk21c0touvj83qpunnonao4vp.apps.googleusercontent.com';

/**
 * The client id this build signs in against.
 *
 * `VITE_GOOGLE_CLIENT_ID` overrides the default, for pointing a local build or
 * a fork at a different OAuth client without editing source.
 */
export function getGoogleClientId(): string {
  const override = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (typeof override === 'string' && override.trim()) return override.trim();
  return DEFAULT_GOOGLE_CLIENT_ID.trim();
}

export function isGoogleSignInConfigured(): boolean {
  return getGoogleClientId().length > 0;
}

let scriptPromise: Promise<void> | null = null;

/** Injects the GSI script once, and resolves when it is usable. */
export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement('script');

    const settle = () => {
      if (window.google?.accounts?.id) resolve();
      else reject(new Error('Google sign-in loaded but did not initialise.'));
    };

    script.addEventListener('load', settle);
    script.addEventListener('error', () => {
      // Let a later attempt retry rather than caching the failure forever —
      // this is usually a blocked script or a dropped connection, not a
      // permanent condition.
      scriptPromise = null;
      reject(new Error('Could not reach Google sign-in. Check your connection or any script blocker.'));
    });

    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (window.google?.accounts?.id) {
      settle();
    }
  });

  return scriptPromise;
}

/**
 * Draws Google's own sign-in button into `container` and reports the credential
 * it produces.
 *
 * Google's rendered button is used rather than One Tap's `prompt()` because it
 * degrades predictably: it is a visible control the user clicks, so a suppressed
 * or dismissed One Tap can't leave the modal looking broken with nothing in it.
 */
export async function renderGoogleSignInButton(
  container: HTMLElement,
  onCredential: (credential: string) => void,
  onError: (message: string) => void
): Promise<void> {
  const clientId = getGoogleClientId();
  if (!clientId) {
    onError('Google sign-in is not configured for this build (VITE_GOOGLE_CLIENT_ID is unset).');
    return;
  }

  await loadGoogleIdentity();
  const id = window.google?.accounts?.id;
  if (!id) {
    onError('Google sign-in is unavailable.');
    return;
  }

  id.initialize({
    client_id: clientId,
    callback: (response) => {
      if (response.credential) onCredential(response.credential);
      else onError('Google did not return a credential. Please try again.');
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  container.replaceChildren();
  id.renderButton(container, {
    type: 'standard',
    theme: document.documentElement.classList.contains('dark') ? 'filled_black' : 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alignment: 'left',
    width: 320,
  });
}

/**
 * Stops Google from silently re-authenticating on the next visit.
 *
 * Without this, signing out clears our session but leaves Google's, so One Tap
 * can hand the same account straight back and the sign-out looks like it failed.
 */
export function disableGoogleAutoSelect(): void {
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    // Nothing to disable if the script never loaded.
  }
}
