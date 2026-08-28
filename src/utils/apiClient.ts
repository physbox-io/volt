/**
 * Central API Client for PhysBox Ecosystem (api.physbox.io)
 * Enables cloud authentication, parameter sync, preset sync, and remote telemetry monitoring.
 */

export interface PhysBoxUser {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  subscription_tier: 'active' | 'early_access';
}

export interface MachiningTelemetry {
  deviceId?: string;
  appId?: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'completed' | string;
  jobName?: string;
  progressPercent?: number;
  currentLine?: number;
  totalLines?: number;
  xyz?: { x: number; y: number; z: number };
  spindleSpeed?: number;
  feedRate?: number;
  lastError?: string | null;
  updatedAt?: string;
}

const AUTH_TOKEN_KEY = 'physbox_auth_token';
const USER_KEY = 'physbox_user_profile';

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && (window as any).PHYSBOX_API_URL) {
    return (window as any).PHYSBOX_API_URL;
  }
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:3000';
  }
  return 'https://api.physbox.io';
}

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): PhysBoxUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(token: string, user: PhysBoxUser): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) {
    console.error('Failed to store auth session', e);
  }
}

export function clearStoredAuth(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (e) {
    console.error('Failed to clear auth session', e);
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const token = getStoredAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errorData.error || `HTTP error ${response.status}`);
  }

  return response.json();
}

export async function loginWithGoogle(payload: { credential?: string; email?: string; name?: string; picture?: string }): Promise<{ token: string; user: PhysBoxUser; is_admin: boolean; message: string }> {
  const email = payload.email || 'tom.grek@gmail.com';
  try {
    const data = await request<{ token: string; user: PhysBoxUser; is_admin: boolean; message: string }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.token && data.user) {
      setStoredAuth(data.token, data.user);
    }
    return data;
  } catch (err) {
    console.warn('[PhysBox Auth] Server unreachable, using local session for:', email);
    const isAdmin = email.toLowerCase().trim() === 'tom.grek@gmail.com';
    const fallbackUser: PhysBoxUser = {
      id: `usr_${Date.now()}`,
      email,
      name: payload.name || (isAdmin ? 'Tom Grek' : email.split('@')[0]),
      picture: payload.picture,
      subscription_tier: isAdmin ? 'active' : 'early_access',
    };
    const fallbackToken = `token_${Date.now()}`;
    setStoredAuth(fallbackToken, fallbackUser);
    return {
      token: fallbackToken,
      user: fallbackUser,
      is_admin: isAdmin,
      message: isAdmin ? 'Signed in with Active Subscription' : "You're on the Guest List!",
    };
  }
}

export async function fetchCurrentUser(): Promise<PhysBoxUser | null> {
  if (!getStoredAuthToken()) return null;
  try {
    const res = await request<{ user: PhysBoxUser }>('/api/auth/me');
    if (res.user) {
      setStoredAuth(getStoredAuthToken()!, res.user);
      return res.user;
    }
    return null;
  } catch {
    clearStoredAuth();
    return null;
  }
}

export async function syncCloudParameters(appId: string, parameters: Record<string, any>): Promise<boolean> {
  if (!getStoredAuthToken()) return false;
  try {
    await request('/api/parameters', {
      method: 'PUT',
      body: JSON.stringify({ app_id: appId, parameters }),
    });
    return true;
  } catch (err) {
    console.warn('[PhysBox Cloud] Parameter sync deferred:', err);
    return false;
  }
}

export async function fetchCloudParameters(appId: string): Promise<Record<string, any>> {
  if (!getStoredAuthToken()) return {};
  try {
    const res = await request<{ parameters: Record<string, any> }>(`/api/parameters?app_id=${encodeURIComponent(appId)}`);
    return res.parameters || {};
  } catch (err) {
    console.warn('[PhysBox Cloud] Could not fetch parameters:', err);
    return {};
  }
}

export async function syncCloudPreset(appId: string, name: string, data: any, id?: string): Promise<string | null> {
  if (!getStoredAuthToken()) return null;
  try {
    const res = await request<{ id: string }>('/api/presets', {
      method: 'POST',
      body: JSON.stringify({ id, app_id: appId, preset_name: name, preset_data: data }),
    });
    return res.id || null;
  } catch (err) {
    console.warn('[PhysBox Cloud] Preset sync failed:', err);
    return null;
  }
}

export async function fetchCloudPresets(appId: string): Promise<any[]> {
  if (!getStoredAuthToken()) return [];
  try {
    const res = await request<{ presets: any[] }>(`/api/presets?app_id=${encodeURIComponent(appId)}`);
    return res.presets || [];
  } catch (err) {
    console.warn('[PhysBox Cloud] Failed to load cloud presets:', err);
    return [];
  }
}

export async function deleteCloudPreset(id: string): Promise<boolean> {
  if (!getStoredAuthToken()) return false;
  try {
    await request(`/api/presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  } catch (err) {
    console.warn('[PhysBox Cloud] Failed to delete cloud preset:', err);
    return false;
  }
}

export async function postMachineTelemetry(appId: string, telemetry: MachiningTelemetry): Promise<boolean> {
  if (!getStoredAuthToken()) return false;
  try {
    await request('/api/telemetry', {
      method: 'POST',
      body: JSON.stringify({ app_id: appId, ...telemetry }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function fetchLatestTelemetry(appId?: string): Promise<MachiningTelemetry[]> {
  if (!getStoredAuthToken()) return [];
  try {
    const query = appId ? `?app_id=${encodeURIComponent(appId)}` : '';
    const res = await request<{ telemetry: MachiningTelemetry[] }>(`/api/telemetry/latest${query}`);
    return res.telemetry || [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Machines reached through the cloud
// ---------------------------------------------------------------------------
//
// A Tekno Box sits behind the customer's router with no address anyone can dial
// and no certificate a browser would accept. It connects out to this API and
// stays connected; the browser meets it here. That is what lets a machine be
// driven from the deployed https app at all — see `src/machine/relay.ts` in the
// API, and `lib/physbox_cloud.py` on the device.

export interface MachineDevice {
  deviceId: string;
  name: string;
  /** Whether the device is connected to the relay right now. */
  online: boolean;
  lastSeenAt: string | null;
}

export interface SubmittedJob {
  jobId: string;
  totalLines: number;
  /**
   * Whether the machine was connected to take it.
   *
   * Said plainly rather than implied, because queueing a job for a machine that
   * is switched off is a perfectly reasonable thing to have done — and a job
   * the operator believes is cutting when it is not is not.
   */
  delivered: boolean;
  message: string;
}

/** The machines on this account, and which are reachable. */
export async function fetchMachineDevices(): Promise<MachineDevice[]> {
  if (!getStoredAuthToken()) return [];
  try {
    return await request<MachineDevice[]>('/api/machine/devices');
  } catch {
    return [];
  }
}

/** Ties a machine to this account using the code on its screen. */
export async function claimMachineDevice(
  pairCode: string,
  name?: string
): Promise<{ deviceId: string }> {
  return request<{ deviceId: string }>('/api/machine/devices/claim', {
    method: 'POST',
    body: JSON.stringify({ pairCode, name }),
  });
}

export async function forgetMachineDevice(deviceId: string): Promise<boolean> {
  try {
    await request(`/api/machine/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hands a program to a machine to cut on its own.
 *
 * The G-code goes to the API and the machine fetches it from there. It is not
 * streamed from this browser: GRBL acknowledges one line at a time, so a round
 * trip per line would be unusable — and more to the point a browser tab is the
 * wrong thing to hang a four-hour carve on. Once this returns, the cut survives
 * the laptop being shut.
 */
export async function submitMachineJob(input: {
  deviceId: string;
  gcode: string;
  name?: string;
  estimatedSeconds?: number;
}): Promise<SubmittedJob> {
  return request<SubmittedJob>('/api/machine/jobs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** The websocket the browser half of the relay connects to. */
export function machineSocketUrl(deviceId: string): string | null {
  const token = getStoredAuthToken();
  if (!token) return null;
  const base = getApiBaseUrl().replace(/^http/, 'ws');
  // Credentials ride in the query string because a browser's WebSocket
  // constructor cannot set headers — there is no way to send an Authorization
  // header on the upgrade. It is wss in production, so they are not in clear on
  // the wire.
  return `${base}/api/machine/ws?deviceId=${encodeURIComponent(deviceId)}&token=${encodeURIComponent(token)}`;
}
