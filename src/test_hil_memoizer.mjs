import assert from 'node:assert';

// Inline test version of HILMemoizer to run directly under node without transpiler dependency
class TestHILMemoizer {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.inputDP = options.inputDP ?? 3;
    this.icDP = options.icDP ?? 3;
    this.maxEntries = options.maxEntries ?? 5;
    this.maxConsecutiveHits = options.maxConsecutiveHits ?? 3;

    this.cacheMap = new Map();
    this.hitsCount = 0;
    this.missesCount = 0;
    this.consecutiveHitsCount = 0;
  }

  generateKey(inputs, initialConditions, sliceDurationMs, maxStepMs) {
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

  get(inputs, initialConditions, sliceDurationMs, maxStepMs) {
    if (!this.enabled) return null;

    if (this.consecutiveHitsCount >= this.maxConsecutiveHits) {
      this.consecutiveHitsCount = 0;
      this.missesCount++;
      return null;
    }

    const key = this.generateKey(inputs, initialConditions, sliceDurationMs, maxStepMs);
    const cached = this.cacheMap.get(key);

    if (cached) {
      this.hitsCount++;
      this.consecutiveHitsCount++;
      this.cacheMap.delete(key);
      this.cacheMap.set(key, cached);
      return cached;
    }

    this.consecutiveHitsCount = 0;
    this.missesCount++;
    return null;
  }

  set(inputs, initialConditions, sliceDurationMs, maxStepMs, val) {
    if (!this.enabled) return;

    const key = this.generateKey(inputs, initialConditions, sliceDurationMs, maxStepMs);

    if (this.cacheMap.size >= this.maxEntries && !this.cacheMap.has(key)) {
      const oldestKey = this.cacheMap.keys().next().value;
      if (oldestKey !== undefined) {
        this.cacheMap.delete(oldestKey);
      }
    }

    this.cacheMap.set(key, val);
  }

  getStats() {
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

console.log("⚡ Testing HIL Memoizer logic...");

const memoizer = new TestHILMemoizer({
  inputDP: 3,
  icDP: 3,
  maxEntries: 3,
  maxConsecutiveHits: 2
});

const dummyInputs = { GPIO_1: 1.23456, GPIO_3: 0.0 };
const dummyICs = { '1': 3.2999, '2': 0.0001 };
const dummyResult = { mock: 'result_data' };

// 1. Initial Get should MISS
assert.strictEqual(memoizer.get(dummyInputs, dummyICs, 50, 1.0), null, 'Initial lookup should be a miss');
assert.strictEqual(memoizer.getStats().misses, 1);

// 2. Set entry
memoizer.set(dummyInputs, dummyICs, 50, 1.0, dummyResult);
assert.strictEqual(memoizer.getStats().entryCount, 1);

// 3. Lookup with inputs rounded within 3 DP (e.g. 1.23456 vs 1.23488 both round to 1.235) should HIT
const roundedInputs = { GPIO_1: 1.23488, GPIO_3: 0.0001 };
const hitResult1 = memoizer.get(roundedInputs, dummyICs, 50, 1.0);
assert.deepStrictEqual(hitResult1, dummyResult, 'Rounded lookup within 3 DP should hit cache');
assert.strictEqual(memoizer.getStats().hits, 1);

// 4. Second Hit
const hitResult2 = memoizer.get(roundedInputs, dummyICs, 50, 1.0);
assert.deepStrictEqual(hitResult2, dummyResult);
assert.strictEqual(memoizer.getStats().hits, 2);

// 5. Third Hit should be blocked by maxConsecutiveHits (set to 2) -> forced MISS
const forcedMiss = memoizer.get(roundedInputs, dummyICs, 50, 1.0);
assert.strictEqual(forcedMiss, null, 'Lookup exceeding maxConsecutiveHits should force a miss');
assert.strictEqual(memoizer.getStats().misses, 2);

// 6. Test Input Change (outside 3 DP: 1.500 vs 1.235) should MISS
const newInputs = { GPIO_1: 1.500, GPIO_3: 0.0 };
assert.strictEqual(memoizer.get(newInputs, dummyICs, 50, 1.0), null, 'Different inputs should miss');

// 7. Test LRU Capacity Eviction (maxEntries = 3)
memoizer.set({ GPIO_1: 1.0 }, dummyICs, 50, 1.0, { res: 1 });
memoizer.set({ GPIO_1: 2.0 }, dummyICs, 50, 1.0, { res: 2 });
memoizer.set({ GPIO_1: 3.0 }, dummyICs, 50, 1.0, { res: 3 });
memoizer.set({ GPIO_1: 4.0 }, dummyICs, 50, 1.0, { res: 4 });

assert.strictEqual(memoizer.getStats().entryCount, 3, 'Cache should evict oldest entry to stay within maxEntries');

console.log("✅ All HIL Memoizer unit tests passed successfully!");
