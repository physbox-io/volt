/**
 * Turning what ngspice said into what to do about it.
 *
 * A failed run used to be invisible. The engine does not reject on a bad
 * circuit — it resolves with an empty `constants` plot and puts the reason on
 * its error channel — so `await runSim()` returned something that looked like a
 * result, the page read no data out of it, and the only trace was a line in the
 * console. Everything here exists so that the reason reaches the person who can
 * act on it, in their words rather than the solver's.
 */

export type SpiceAnalysisKind = 'tran' | 'op' | 'ac';

/** The plot ngspice names when the analysis it was given actually ran. */
export const EXPECTED_PLOT: Record<SpiceAnalysisKind, string> = {
  tran: 'Transient Analysis',
  op: 'Operating Point',
  ac: 'AC Analysis',
};

/**
 * Lines the engine emits on every cold start, whatever the circuit.
 *
 * The WASM build has no code-model libraries on disk and says so seven times
 * before the first run of a session. They are not about the circuit and there
 * is nothing to do about them, so they never reach the panel.
 */
export function isEngineNoise(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  return (
    s.includes('/usr/local/lib/ngspice/') ||
    s.startsWith("Error: Library ") ||
    s.includes('code model') ||
    s.includes("can't find the initialization file spinit") ||
    s.includes('SPARSE 1.3') ||
    s.includes('OSDI')
  );
}

export function cleanSpiceMessages(lines: string[] | undefined): string[] {
  if (!lines) return [];
  const out: string[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (isEngineNoise(s)) continue;
    if (out[out.length - 1] === s) continue;
    out.push(s);
  }
  return out;
}

/** The plot name out of a raw-file header, when there is one. */
export function plotNameOf(header: string | undefined): string | null {
  const m = /Plotname:\s*(.*)/.exec(header ?? '');
  return m ? m[1].trim() : null;
}

/**
 * What went wrong, and the one thing most likely to fix it.
 *
 * Each hint is the first thing someone who knew ngspice would say, and the
 * solver's own words are kept alongside rather than replaced — a hint that
 * guesses wrong has to leave the evidence for someone who can read it.
 */
export function explainSpiceFailure(messages: string[]): { title: string; detail: string } {
  const all = messages.join('\n');
  const evidence = messages.slice(0, 4).join(' · ');

  const hint = (title: string, advice: string) => ({
    title,
    detail: evidence ? `${advice}\n\nngspice said: ${evidence}` : advice,
  });

  if (/timestep too small|time step too small/i.test(all)) {
    return hint(
      'The solver could not take a small enough step',
      'Usually an LC loop with nothing to damp it, or a switching edge with no capacitance to round it off. A little series resistance in the loop, or a slower edge on the source, normally settles it.',
    );
  }
  if (/singular matrix/i.test(all)) {
    const node = /singular matrix:?\s*check\s+node\s+(\S+)/i.exec(all)?.[1];
    return hint(
      node ? `Nothing sets the voltage at ${node}` : 'Part of the circuit has no voltage reference',
      'A node with no DC path to ground has no solution. Check for a missing ground, a supply that is not wired back, or a section joined to the rest only through capacitors.',
    );
  }
  if (/no convergence|iteration limit|failed to converge|transient solution failed/i.test(all)) {
    return hint(
      'The solver did not converge',
      'The circuit has more than one possible answer or is switching too hard for the step size. Try Res: High, or give feedback loops a little resistance.',
    );
  }
  if (/could not find a valid modelname|can't find model|unknown subckt|unable to find definition/i.test(all)) {
    return hint(
      'A part has no model behind it',
      'Reselect the part in the properties panel — its model reference has gone stale.',
    );
  }
  if (/circuit not parsed|error on line/i.test(all)) {
    const line = /Error on line[^:]*:\s*\n?\s*(.*)/i.exec(all)?.[1];
    return hint(
      'The netlist did not parse',
      line ? `ngspice rejected: ${line.trim()}` : 'One of the cards in the netlist was rejected.',
    );
  }
  if (/TIMED_OUT/.test(all)) {
    return {
      title: 'The simulation did not finish',
      detail: 'The solver stopped responding and the run was abandoned. A shorter duration, or Res: Normal, will usually get through.',
    };
  }
  return hint(
    'The simulation did not produce any data',
    'The circuit was solved to nothing. Check that it has a source, a ground, and a complete loop between them.',
  );
}

/**
 * Warnings from a run that did produce data.
 *
 * Kept apart from a failure because the trace on screen is real and worth
 * reading — this is the footnote to it, not a reason to distrust it.
 */
export function summariseSpiceWarnings(messages: string[]): string | null {
  if (messages.length === 0) return null;
  return messages.slice(0, 3).join(' · ');
}

/**
 * A run that did not produce data, carrying what the solver said.
 *
 * An `Error` rather than a returned value because every caller already has a
 * `try`/`catch` around a solve and none of them had anywhere to put a second
 * return channel — and because a failed run genuinely is exceptional: nothing
 * downstream of it has anything to read.
 */
export class SpiceRunError extends Error {
  readonly messages: string[];
  constructor(message: string, messages?: string[]) {
    super(message);
    this.name = 'SpiceRunError';
    this.messages = messages && messages.length > 0 ? messages : [message];
  }
}

/** Whatever was thrown, as the lines to explain. */
export function messagesFromError(err: unknown): string[] {
  if (err instanceof SpiceRunError) return err.messages;
  if (err instanceof Error) return [err.message];
  return [String(err)];
}
