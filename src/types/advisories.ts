/**
 * What Volt has to say about a circuit that it was not asked about.
 *
 * Three sources produce these — the electrical rules check, the component
 * rating check, and a simulation run that failed or complained — and all three
 * land in the same list so there is exactly one place on screen where the app
 * tells you something is wrong. Nothing here interrupts: a run still runs, a
 * shunted floating pin is still shunted, and the canvas is unchanged. The only
 * difference is that the reason is now written down somewhere.
 */
export type AdvisorySeverity = 'error' | 'warning' | 'advisory';

export type Advisory = {
  /**
   * Stable across re-checks of the same circuit, so the panel can keep a
   * dismissed advisory dismissed while values are being scrubbed, and so a
   * list that has not changed does not re-render as though it had.
   */
  id: string;
  severity: AdvisorySeverity;
  /** The part this is about, when it is about one. Clicking selects it. */
  nodeId?: string;
  /** One line, in the terms someone at a bench would use. */
  title: string;
  /** Why, and what to do about it. Optional; the title has to stand alone. */
  detail?: string;
};

/** Worst first, then by title so the list does not shuffle between runs. */
const RANK: Record<AdvisorySeverity, number> = { error: 0, warning: 1, advisory: 2 };

export function sortAdvisories(list: Advisory[]): Advisory[] {
  return [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.title.localeCompare(b.title));
}

export function countBySeverity(list: Advisory[]) {
  let errors = 0, warnings = 0, advisories = 0;
  for (const a of list) {
    if (a.severity === 'error') errors++;
    else if (a.severity === 'warning') warnings++;
    else advisories++;
  }
  return { errors, warnings, advisories };
}
