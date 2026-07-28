export interface CachedHILSliceResult {
  result: any;
  portToNet: Record<string, string>;
  nextICs: Record<string, number>;
  outputs: Record<string, [number, number][]>;
  writes: { pin: number; seq: [number, number][] }[];
  reads: { pin: number; type: 'analog' | 'digital' }[];
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
    this.maxEntries = options.maxEntries ?? 2000;
    this.maxConsecutiveHits = options.maxConsecutiveHits ?? 50;
  }

  /**
   * Deterministically stringify and round input voltages and initial conditions
   */
  public generateKey(
    inputs: Record<string, number>,
    initialConditions: Record<string, number>,
    sliceDurationMs: number,
    maxStepMs: number
  ): string {
    const sortedInputKeys = Object.keys(inputs).sort();
    const inputParts = sortedInputKeys.map(
      k => `${k}:${(inputs[k] ?? 0).toFixed(this.inputDP)}`
    );

    const sortedICKeys = Object.keys(initialConditions).sort();
    const icParts = sortedICKeys.map(
      k => `${k}:${(initialConditions[k] ?? 0).toFixed(this.icDP)}`
    );

    return `U[${inputParts.join(';')}]|IC[${icParts.join(';')}]|dt:${sliceDurationMs.toFixed(2)}|step:${maxStepMs.toFixed(4)}`;
  }

  /**
   * Get cached simulation result for given inputs & initial conditions
   */
  public get(
    inputs: Record<string, number>,
    initialConditions: Record<string, number>,
    sliceDurationMs: number,
    maxStepMs: number
  ): CachedHILSliceResult | null {
    if (!this.enabled) return null;

    if (this.consecutiveHitsCount >= this.maxConsecutiveHits) {
      // Safety threshold reached: force fresh SPICE run to eliminate accumulated drift
      this.consecutiveHitsCount = 0;
      this.missesCount++;
      return null;
    }

    const key = this.generateKey(inputs, initialConditions, sliceDurationMs, maxStepMs);
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
    val: CachedHILSliceResult
  ): void {
    if (!this.enabled) return;

    const key = this.generateKey(inputs, initialConditions, sliceDurationMs, maxStepMs);

    // Evict oldest if exceeding capacity
    if (this.cacheMap.size >= this.maxEntries && !this.cacheMap.has(key)) {
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
