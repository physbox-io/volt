import type { SpiceResult } from '../types/simulation';
import type { NetlistResultIndex } from './netlistResult';

export interface CachedHILSliceResult {
  /** The SPICE run for the slice, carried verbatim and handed straight back. */
  result: SpiceResult;
  /** Its lookup index, built once rather than on every hit. */
  index: NetlistResultIndex;
  portToNet: Record<string, string>;
  nextICs: Record<string, number>;
  outputs: Record<string, [number, number][]>;
  halfPeriods: Record<string, number>;
}

export interface HILMemoizerOptions {
  enabled?: boolean;
  inputDP?: number;
  icDP?: number;
  maxEntries?: number;
  maxConsecutiveHits?: number;
}

export interface HILMemoizerStats {
  hits: number;
  misses: number;
  hitRatePct: number;
  entryCount: number;
  consecutiveHits: number;
}

export class HILMemoizer {
  public enabled: boolean;
  public inputDP: number;
  public icDP: number;
  public maxEntries: number;
  public maxConsecutiveHits: number;

  private cacheMap = new Map<string, CachedHILSliceResult>();
  private hitsCount = 0;
  private missesCount = 0;
  private consecutiveHitsCount = 0;

  constructor(options: HILMemoizerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.inputDP = options.inputDP ?? 3;
    this.icDP = options.icDP ?? 3;
    this.maxEntries = options.maxEntries ?? 256;
    this.maxConsecutiveHits = options.maxConsecutiveHits ?? 50;
  }

  private fmtNum(val: number | undefined, dp: number): string {
    const n = val ?? 0;
    const s = (n === 0 ? 0 : n).toFixed(dp);
    return s === `-${(0).toFixed(dp)}` ? (0).toFixed(dp) : s;
  }

  /**
   * Deterministically stringify and round input voltages and initial conditions.
   *
   * `drive` is anything else the slice's answer depends on, already in string
   * form — what a sketch drives onto its pins this slice, which changes the
   * answer without changing any input or initial condition.
   */
  public generateKey(
    inputs: Record<string, number>,
    initialConditions: Record<string, number>,
    sliceDurationMs: number,
    maxStepMs: number,
    drive = '',
    circuitKey = ''
  ): string {
    const sortedInputKeys = Object.keys(inputs).sort();
    const inputParts = sortedInputKeys.map(
      k => `${k}:${this.fmtNum(inputs[k], this.inputDP)}`
    );

    const sortedICKeys = Object.keys(initialConditions).sort();
    const icParts = sortedICKeys.map(
      k => `${k}:${this.fmtNum(initialConditions[k], this.icDP)}`
    );

    return `U[${inputParts.join(';')}]|IC[${icParts.join(';')}]|dt:${this.fmtNum(sliceDurationMs, 2)}|step:${this.fmtNum(maxStepMs, 4)}|drive:${drive}${circuitKey ? `|ckt:${circuitKey}` : ''}`;
  }

  /**
   * Get cached simulation result for given inputs & initial conditions
   */
  public get(
    inputs: Record<string, number>,
    initialConditions: Record<string, number>,
    sliceDurationMs: number,
    maxStepMs: number,
    drive = '',
    circuitKey = ''
  ): CachedHILSliceResult | null {
    if (!this.enabled) return null;

    if (this.consecutiveHitsCount >= this.maxConsecutiveHits) {
      // Safety threshold reached: force fresh SPICE run to eliminate accumulated drift
      this.consecutiveHitsCount = 0;
      this.missesCount++;
      return null;
    }

    const key = this.generateKey(inputs, initialConditions, sliceDurationMs, maxStepMs, drive, circuitKey);
    const cached = this.cacheMap.get(key);

    if (cached) {
      this.hitsCount++;
      this.consecutiveHitsCount++;
      // Refresh LRU order (delete and re-set)
      this.cacheMap.delete(key);
      this.cacheMap.set(key, cached);
      return cached;
    }

    this.consecutiveHitsCount = 0;
    this.missesCount++;
    return null;
  }

  /**
   * Store simulation result in LRU cache
   */
  public set(
    inputs: Record<string, number>,
    initialConditions: Record<string, number>,
    sliceDurationMs: number,
    maxStepMs: number,
    val: CachedHILSliceResult,
    drive = '',
    circuitKey = ''
  ): void {
    if (!this.enabled) return;

    const key = this.generateKey(inputs, initialConditions, sliceDurationMs, maxStepMs, drive, circuitKey);

    if (this.cacheMap.has(key)) {
      // Refresh LRU recency on overwrite.
      this.cacheMap.delete(key);
    } else if (this.cacheMap.size >= this.maxEntries) {
      const oldestKey = this.cacheMap.keys().next().value;
      if (oldestKey !== undefined) {
        this.cacheMap.delete(oldestKey);
      }
    }

    this.cacheMap.set(key, val);
  }

  /**
   * Clear cache and reset stats
   */
  public clear(): void {
    this.cacheMap.clear();
    this.hitsCount = 0;
    this.missesCount = 0;
    this.consecutiveHitsCount = 0;
  }

  /**
   * Get live cache performance statistics
   */
  public getStats(): HILMemoizerStats {
    const total = this.hitsCount + this.missesCount;
    const hitRatePct = total > 0 ? (this.hitsCount / total) * 100 : 0;
    return {
      hits: this.hitsCount,
      misses: this.missesCount,
      hitRatePct: Math.round(hitRatePct * 10) / 10,
      entryCount: this.cacheMap.size,
      consecutiveHits: this.consecutiveHitsCount
    };
  }
}
