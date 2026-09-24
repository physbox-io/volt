/// <reference lib="webworker" />
import { Simulation } from 'eecircuit-engine';
import {
  EXPECTED_PLOT,
  cleanSpiceMessages,
  plotNameOf,
  type SpiceAnalysisKind,
} from '../utils/simDiagnostics';
import { packResult } from '../utils/simTransfer';

let engine: Simulation | null = null;

/**
 * What the page sends in. Written down here rather than read off `evt.data`
 * as-is, because a worker's message is a call with no compiler checking across
 * it: the page that posts and this file agree on the field names by hand, and a
 * RUN that arrived with no netlist would re-run the previous one in silence.
 */
type SimRequest =
  | { type: 'INIT' }
  | {
      type: 'RUN';
      id: number | string;
      netlist: string;
      /** Which analysis the netlist ends in. Absent means the transient one. */
      analysis?: SpiceAnalysisKind;
      /** Milliseconds before the run is abandoned. Absent means the default. */
      timeoutMs?: number;
    };

/**
 * How long a solve is given before it is treated as wedged.
 *
 * Not a guess at how long a circuit takes — the slowest thing this app emits
 * finishes in a couple of seconds. It is the ceiling on how long the engine may
 * hold the UI in "SPICE Simulating" when it is never going to answer, which it
 * can be: `runSim` resolves from a callback that fires only when the raw file
 * parses, so a run whose output never lands leaves a promise nobody settles.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/** A wedged engine is replaced rather than reused; its loop is still waiting. */
function discardEngine() {
  engine = null;
}

async function getEngine(): Promise<Simulation> {
  if (!engine) {
    engine = new Simulation();
    await engine.start();
  }
  return engine;
}

/*
 * One solve at a time.
 *
 * `onmessage` is async, so a second message dispatches while the first is still
 * awaiting — and two `runSim()` calls against one engine share its raw file and
 * its error channel, so the second overwrites what the first is about to read.
 * With the DC overlay and a frequency sweep now able to arrive alongside a
 * transient run, requests are chained rather than raced.
 */
let queue: Promise<void> = Promise.resolve();

self.onmessage = (evt: MessageEvent<SimRequest>) => {
  queue = queue.then(() => handle(evt.data)).catch(err => {
    console.error('[SimulationWorker] unhandled:', err);
  });
};

const handle = async (req: SimRequest) => {

  if (req.type === 'INIT') {
    try {
      await getEngine();
    } catch (err) {
      console.error("[SimulationWorker] error preloading simulation engine:", err);
    }
    return;
  }

  if (req.type !== 'RUN') return;

  const { id, netlist } = req;
  const analysis: SpiceAnalysisKind = req.analysis ?? 'tran';

  try {
    const sim = await getEngine();
    sim.setNetList(netlist);

    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      sim.runSim(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TIMED_OUT')), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));

    /*
     * The engine does not reject a circuit it could not solve.
     *
     * A netlist ngspice refuses still resolves — with the `constants` plot, no
     * variables and the reason on the error channel — so a run that failed and
     * a run that succeeded are told apart here rather than by whether the
     * promise settled. Checking the plot name as well as the variable count is
     * what catches the other half of it: the raw file is written per run and
     * read back per run, so a failed run can hand back the *previous* run's
     * data, which is worse than no data because it looks right.
     */
    const messages = cleanSpiceMessages(sim.getError());
    const plot = plotNameOf(result?.header);
    const expected = EXPECTED_PLOT[analysis];
    const emptyResult = !result || !result.variableNames || result.variableNames.length === 0;
    const wrongPlot = !!plot && plot !== expected;

    if (emptyResult || wrongPlot) {
      self.postMessage({
        type: 'RESULT',
        id,
        ok: false,
        error: messages.length > 0 ? messages.join('\n') : 'The circuit produced no data.',
        messages: messages.length > 0
          ? messages
          : [wrongPlot ? `ngspice ran a ${plot} instead of the ${expected} that was asked for.` : 'The circuit produced no data.'],
      });
      return;
    }

    const { packed, transfer } = packResult(result);
    self.postMessage({ type: 'RESULT', id, result: packed, ok: true, messages }, transfer);
  } catch (err) {
    const message = (err as { message?: string })?.message;
    if (message === 'TIMED_OUT') discardEngine();
    // Read off the value rather than narrowed to `Error`: the SPICE WASM
    // module rejects with bare objects carrying a message as well as with
    // real Errors, and both used to reach the page as the message.
    const messages = engine ? cleanSpiceMessages(engine.getError()) : [];
    self.postMessage({
      type: 'RESULT',
      id,
      ok: false,
      error: message || String(err),
      messages: messages.length > 0 ? messages : [message || String(err)],
    });
  }
};
