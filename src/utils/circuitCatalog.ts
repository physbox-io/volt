/**
 * What the circuit browser lists: the built-in examples by shelf, and a search
 * across them and the saved circuits at once.
 *
 * Pure, so it is tested without a browser. The shelves and emoji live here
 * rather than on each preset because a shelf is a menu decision, not part of
 * a circuit, and a preset travels into saves, the account and share links.
 */

import { presets } from './presets';

export type ExampleShelf = 'Start here' | 'Analog & audio' | 'Timing & logic' | 'Power' | 'Microcontrollers' | 'Hardware in the loop' | 'Motors';

/** The order the shelves are shown in. */
export const EXAMPLE_SHELVES: ExampleShelf[] = [
  'Start here', 'Analog & audio', 'Timing & logic', 'Power', 'Microcontrollers', 'Hardware in the loop', 'Motors',
];

/**
 * Which shelf each preset sits on, and the emoji on its card. A preset missing
 * from here still shows, under the last shelf; tests/circuitCatalog.test.ts
 * makes sure none is missing.
 */
export const PRESET_SHELF: Record<string, { shelf: ExampleShelf; emoji: string }> = {
  empty: { shelf: 'Start here', emoji: '⬜' },
  basicBlink: { shelf: 'Start here', emoji: '💡' },
  potDimmer: { shelf: 'Start here', emoji: '🎚️' },

  sallenKeyFilter: { shelf: 'Analog & audio', emoji: '〰️' },
  voltageComparator: { shelf: 'Analog & audio', emoji: '⚖️' },
  sineAudio: { shelf: 'Analog & audio', emoji: '🔊' },
  micSpeaker: { shelf: 'Analog & audio', emoji: '🎤' },
  bjtAmp: { shelf: 'Analog & audio', emoji: '📢' },
  opAmpAmp: { shelf: 'Analog & audio', emoji: '🔺' },
  classBamp: { shelf: 'Analog & audio', emoji: '🔉' },
  classABamp: { shelf: 'Analog & audio', emoji: '🎶' },
  currentMirror: { shelf: 'Analog & audio', emoji: '🪞' },
  portedSpeaker: { shelf: 'Analog & audio', emoji: '🔈' },

  astableMultivibrator: { shelf: 'Timing & logic', emoji: '⏱️' },
  timer555Blink: { shelf: 'Timing & logic', emoji: '⏲️' },
  bistableMultivibrator: { shelf: 'Timing & logic', emoji: '🔀' },
  mixedLogicBlink: { shelf: 'Timing & logic', emoji: '🔣' },
  dffBlinker: { shelf: 'Timing & logic', emoji: '🔁' },
  sevenSegDirect: { shelf: 'Timing & logic', emoji: '🔢' },

  bridgeRectifier: { shelf: 'Power', emoji: '🌉' },
  transformerRectifier: { shelf: 'Power', emoji: '🔌' },
  boostConverter: { shelf: 'Power', emoji: '⬆️' },
  buckConverter: { shelf: 'Power', emoji: '⬇️' },

  mcuBlink: { shelf: 'Microcontrollers', emoji: '🔆' },
  mcuSpeaker: { shelf: 'Microcontrollers', emoji: '🎵' },
  mcuAnalogOut: { shelf: 'Microcontrollers', emoji: '📈' },
  mcuAnalogIn: { shelf: 'Microcontrollers', emoji: '📥' },
  mcuPassThrough: { shelf: 'Microcontrollers', emoji: '🎙️' },
  mcuCleanAudioSampler: { shelf: 'Microcontrollers', emoji: '🎧' },

  ldrWebcamDemo: { shelf: 'Hardware in the loop', emoji: '📷' },
  heltecLightToFreqHIL: { shelf: 'Hardware in the loop', emoji: '🌤️' },
  heltecGPIOToCYDSpeakerHIL: { shelf: 'Hardware in the loop', emoji: '📟' },
  heltecCc1101: { shelf: 'Hardware in the loop', emoji: '📡' },

  gearmotorTrip: { shelf: 'Motors', emoji: '⚙️' },
  nema17Stepper: { shelf: 'Motors', emoji: '🔩' },
  gripperLimitSwitch: { shelf: 'Motors', emoji: '🦾' },
};

export interface ExampleEntry {
  id: string;
  name: string;
  emoji: string;
  shelf: ExampleShelf;
}

/** Every built-in preset, shelved, in the shelves' order and then the map's. */
export function exampleEntries(): ExampleEntry[] {
  const entries = Object.entries(presets).map(([id, p]) => ({
    id,
    name: p.name,
    emoji: PRESET_SHELF[id]?.emoji ?? '🧩',
    shelf: PRESET_SHELF[id]?.shelf ?? EXAMPLE_SHELVES[EXAMPLE_SHELVES.length - 1],
  }));
  return EXAMPLE_SHELVES.flatMap((shelf) => entries.filter((e) => e.shelf === shelf));
}

/**
 * Whether `query` finds `text`: every word of the query has to appear, in any
 * order, ignoring case and accents. "555 blink" finds "555 Blinker".
 */
export function matchesQuery(query: string, ...text: (string | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(text.filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * A free name for a copy of `name`: "Bracket copy", then "Bracket copy 2"…
 */
export function copyName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `${name.replace(/ copy( \d+)?$/, '')} copy`;
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * A date the way a file list shows one: the time today, "Yesterday", the day
 * and month this year, and the year as well before that.
 */
export function formatSceneDate(at: number, now = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (at >= startOfToday) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (at >= startOfToday - 86_400_000) return 'Yesterday';
  return d.toLocaleDateString(undefined, d.getFullYear() === today.getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}
