import { describe, expect, it } from 'vitest';
import { ROUTING_BUDGET_LADDER, wantsMoreEffort } from '../src/hooks/usePcbLayout';
import { emptyPcbLayout, type PcbLayoutResult } from '../src/utils/pcbExporter';

/*
 * The router's effort policy, which used to be a dropdown the operator had to
 * set and is now decided here.
 *
 * The measurements behind the ladder are written up on ROUTING_BUDGET_LADDER
 * itself. What is tested here is the escalation rule, because getting it wrong
 * is either a board that gives up while a cheap retry would have routed it, or
 * a board that climbs the whole ladder to arrive at the same answer three
 * times over.
 */

const routed = (completion: number, components: number): PcbLayoutResult =>
  ({
    ...emptyPcbLayout(),
    completion,
    components: Array.from({ length: components }, (_, i) => ({ id: `c${i}` })),
  }) as unknown as PcbLayoutResult;

describe('the routing effort ladder', () => {
  it('starts cheap, so the boards that route pay almost nothing', () => {
    expect(ROUTING_BUDGET_LADDER[0]).toBeLessThanOrEqual(2000);
  });

  it('climbs, without repeating a budget it has already spent', () => {
    const rungs = [...ROUTING_BUDGET_LADDER];
    expect(rungs).toEqual([...rungs].sort((a, b) => a - b));
    expect(new Set(rungs).size).toBe(rungs.length);
  });
});

describe('when a result is worth retrying at more effort', () => {
  it('retries a board that did not come out fully routed', () => {
    expect(wantsMoreEffort(routed(0.77, 9))).toBe(true);
  });

  it('settles as soon as one routes — the whole point of not asking', () => {
    expect(wantsMoreEffort(routed(1, 9))).toBe(false);
  });

  /*
   * A circuit with nothing placeable in it, or one that failed for a reason
   * time cannot fix, reports completion 0 like a stalled route does. Climbing
   * on that spends the entire ladder to produce the same answer it already had.
   */
  it('does not retry a circuit that has nothing to place', () => {
    expect(wantsMoreEffort(emptyPcbLayout(undefined, 'No placeable components.'))).toBe(false);
    expect(wantsMoreEffort(routed(0, 0))).toBe(false);
  });
});
