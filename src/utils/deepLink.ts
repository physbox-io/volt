// ---------------------------------------------------------------------------
// Deep-link URL query parameters for Volt (`?preset=...&open=...&run=1`)
// ---------------------------------------------------------------------------

import { presets } from './presets';

export const START_TOUR_EVENT = 'physbox:start-tour';

export type VoltDeepLinkModal = 'pcb' | 'bode';

export interface VoltDeepLink {
  preset?: string;
  open?: VoltDeepLinkModal;
  run?: boolean;
  tour?: boolean;
}

export function parseVoltDeepLink(search: string): VoltDeepLink | null {
  const trimmed = search.startsWith('?') ? search.slice(1) : search;
  if (!trimmed) return null;
  const params = new URLSearchParams(trimmed);

  const rawPreset = params.get('preset')?.trim();
  const preset = rawPreset && Object.hasOwn(presets, rawPreset) ? rawPreset : undefined;

  const rawOpen = (params.get('open') ?? params.get('modal'))?.trim();
  const open: VoltDeepLinkModal | undefined =
    rawOpen === 'pcb' || rawOpen === 'make' ? 'pcb' : rawOpen === 'bode' ? 'bode' : undefined;

  const run = params.get('run') === '1' || params.get('run') === 'true';
  const tour = params.get('tour') === '1' || params.get('tour') === 'true';

  if (!preset && !open && !run && !tour) return null;
  return {
    ...(preset ? { preset } : {}),
    ...(open ? { open } : {}),
    ...(run ? { run: true } : {}),
    ...(tour ? { tour: true } : {}),
  };
}

export function stripVoltDeepLinkSearch(href: string): string {
  const url = new URL(href, 'https://volt.physbox.io');
  for (const key of ['preset', 'open', 'modal', 'run', 'tour']) {
    url.searchParams.delete(key);
  }
  const qs = url.searchParams.toString();
  return `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`;
}
