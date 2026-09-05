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
  /**
   * Which document is being cut, and what it is being cut at.
   *
   * Optional, and the server treats them that way: it cannot work either out for
   * itself, and three shipped clients post without them. When they are present
   * the archived run records what produced it, which is the difference between
   * "a job ran for 40 minutes" and "that tray was cut from walnut at 82%".
   */
  documentId?: string | null;
  documentRevision?: number | null;
  settings?: Record<string, unknown> | null;
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

/**
 * An API refusal with its machine-readable half kept.
 *
 * Callers used to get a bare `Error` carrying only the server's prose, so the
 * only way to tell "you need Pro for this" from "the network is down" was to
 * match on a sentence — which breaks the next time somebody improves the
 * wording. `code` is the contract; the message is for a human reading a console.
 */
export class PhysBoxApiError extends Error {
  status: number;
  code?: string;
  upgradeUrl?: string;
  /**
   * The whole parsed body.
   *
   * Kept because several refusals carry a field the caller needs to act on — a
   * revision conflict says which revision the server actually holds, and there is
   * no way to recover from one without it.
   */
  body: Record<string, unknown>;

  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PhysBoxApiError';
    this.status = status;
    this.body = body;
    this.code = typeof body.code === 'string' ? body.code : undefined;
    this.upgradeUrl = typeof body.upgradeUrl === 'string' ? body.upgradeUrl : undefined;
  }
}

/** The refusal a free account gets from a Pro-only route. */
export function isProRequired(err: unknown): boolean {
  return err instanceof PhysBoxApiError && err.code === 'pro_required';
}

/**
 * Whether the signed-in account has PhysBox Pro.
 *
 * Read from the stored profile, which makes it a hint rather than an authority:
 * the API decides, and a `pro_required` response is the real answer. It is here
 * so a free session never *makes* a request it is going to be refused — the
 * point of the cloud features is that nothing about the free app changes, and a
 * console full of handled 403s would be a change.
 */
export function isProAccount(): boolean {
  return getStoredUser()?.subscription_tier === 'active';
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
    throw new PhysBoxApiError(
      errorData.error || `HTTP error ${response.status}`,
      response.status,
      errorData
    );
  }

  return response.json();
}

/**
 * Exchanges a Google ID token for a PhysBox session.
 *
 * There is deliberately no offline fallback here. The previous version, when
 * the request failed for any reason, fabricated a token, defaulted the email to
 * the maintainer's own address and granted itself an active subscription — so a
 * dropped connection on someone else's browser signed them in as the owner, and
 * the UI then reported a working cloud sync backed by a token no server would
 * ever accept. A failed sign-in is now just a failed sign-in, and the caller
 * shows the error.
 */
export async function loginWithGoogle(credential: string): Promise<{ token: string; user: PhysBoxUser; is_admin: boolean; message: string }> {
  const data = await request<{ token: string; user: PhysBoxUser; is_admin: boolean; message: string }>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  });
  if (!data.token || !data.user) {
    throw new Error('Sign-in did not return a session.');
  }
  setStoredAuth(data.token, data.user);
  return data;
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

/*
 * Remote monitoring is part of PhysBox Pro.
 *
 * Checked here rather than at each of the three WebSerial managers that call it,
 * and checked *before* the request rather than after a refusal: a free session
 * should make no call at all, not a steady stream of handled 403s. The API is
 * still the authority — this only keeps a machine from talking to a door it
 * already knows is shut.
 */
export async function postMachineTelemetry(appId: string, telemetry: MachiningTelemetry): Promise<boolean> {
  if (!getStoredAuthToken() || !isProAccount()) return false;
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
  if (!getStoredAuthToken() || !isProAccount()) return [];
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

// ---------------------------------------------------------------------------
// Cloud documents and the run archive (PhysBox Pro)
// ---------------------------------------------------------------------------
//
// Everything above this line works for any signed-in account and is unchanged.
// These are the Pro layer: the open document auto-saved against the account with
// revisions to fall back to, and every job a machine has run kept instead of
// overwritten. A free account never calls them — see `isProAccount` — and if one
// somehow does, the API answers `pro_required` and the UI offers the upsell
// rather than an error.

export interface CloudDocumentMeta {
  id: string;
  appId: string;
  name: string;
  revision: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface CloudDocument extends CloudDocumentMeta {
  data: unknown;
}

export interface CloudRevisionMeta {
  revision: number;
  sizeBytes: number;
  /** Null for an automatic checkpoint; set when somebody saved on purpose. */
  label: string | null;
  createdAt: string;
}

export interface ArchivedRun {
  id: string;
  deviceId: string;
  appId: string;
  jobId: string | null;
  documentId: string | null;
  documentRevision: number | null;
  jobName: string;
  status: 'running' | 'completed' | 'cancelled' | 'error' | string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  totalLines: number;
  linesCompleted: number;
  progressPercent: number;
  lastError: string | null;
  /** Whatever the app recorded — material, power, speed, passes. No fixed shape. */
  settings: Record<string, unknown> | null;
}

export interface RunSample {
  tMs: number;
  progressPercent: number;
  currentLine: number;
  xyz: { x: number; y: number; z: number };
  spindleSpeed: number;
  feedRate: number;
  status: string | null;
}

export interface RunFilters {
  appId?: string;
  deviceId?: string;
  status?: string;
  since?: string;
  until?: string;
  q?: string;
  limit?: number;
  before?: string;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Writes the open document to the account.
 *
 * `baseRevision` is the revision the caller started from. Send it and a write
 * built on a stale copy is refused with a 409 instead of quietly overwriting a
 * newer one made on another machine; omit it and the server accepts the write,
 * which is what a first sync from an offline document needs.
 */
export async function putCloudDocument(input: {
  id: string;
  appId: string;
  name: string;
  data: unknown;
  baseRevision?: number;
  label?: string;
}): Promise<{ id: string; revision: number; created?: boolean; checkpointed?: boolean }> {
  return request(`/api/documents/${encodeURIComponent(input.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      app_id: input.appId,
      name: input.name,
      data: input.data,
      base_revision: input.baseRevision,
      label: input.label,
    }),
  });
}

export async function fetchCloudDocuments(appId?: string): Promise<CloudDocumentMeta[]> {
  const res = await request<{ documents: CloudDocumentMeta[] }>(`/api/documents${toQuery({ app_id: appId })}`);
  return res.documents || [];
}

export async function fetchCloudDocument(id: string): Promise<CloudDocument> {
  const res = await request<{ document: CloudDocument }>(`/api/documents/${encodeURIComponent(id)}`);
  return res.document;
}

export async function fetchCloudDocumentRevisions(
  id: string
): Promise<{ current: number; revisions: CloudRevisionMeta[] }> {
  return request(`/api/documents/${encodeURIComponent(id)}/revisions`);
}

export async function fetchCloudDocumentRevision(id: string, revision: number): Promise<{ data: unknown }> {
  return request(`/api/documents/${encodeURIComponent(id)}/revisions/${revision}`);
}

export async function restoreCloudDocument(
  id: string,
  revision: number
): Promise<{ revision: number; restoredFrom: number }> {
  return request(`/api/documents/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    body: JSON.stringify({ revision }),
  });
}

export async function deleteCloudDocument(id: string): Promise<boolean> {
  try {
    await request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

/** Archived runs, newest first. */
export async function fetchRuns(
  filters: RunFilters = {}
): Promise<{ runs: ArchivedRun[]; nextBefore: string | null }> {
  const query = toQuery({
    app_id: filters.appId,
    device_id: filters.deviceId,
    status: filters.status,
    since: filters.since,
    until: filters.until,
    q: filters.q,
    limit: filters.limit,
    before: filters.before,
  });
  return request(`/api/runs${query}`);
}

/** One run with the trace of what the machine was doing throughout it. */
export async function fetchRun(runId: string): Promise<{ run: ArchivedRun; samples: RunSample[] }> {
  return request(`/api/runs/${encodeURIComponent(runId)}`);
}

export interface RunSummary {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  cutSeconds: number;
  failureRate: number;
  byDevice: Array<{ deviceId: string; appId: string; runs: number; cutSeconds: number }>;
  byMaterial: Array<{ material: string; runs: number }>;
}

export async function fetchRunSummary(filters: RunFilters = {}): Promise<RunSummary> {
  return request(`/api/runs/summary${toQuery({ app_id: filters.appId, since: filters.since, until: filters.until })}`);
}
