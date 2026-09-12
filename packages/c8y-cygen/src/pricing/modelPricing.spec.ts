import { costOf, PricingError, PRICE_TABLE_VERSION, type UsageRecord } from "./modelPricing.js";

function usage(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    priceTableVersion: PRICE_TABLE_VERSION,
    model: "claude-opus-5",
    ...over,
  };
}

/** Opus 5: 5m writes at $6.25/M, 1h writes at $10.00/M. */
const PER_M = 1_000_000;

describe("what a cache write costs", () => {
  it("charges each half at its own rate when the response reports both", () => {
    const cost = costOf(
      usage({ cacheCreationInputTokens: 3000, cacheCreation5m: 1000, cacheCreation1h: 2000 })
    );

    expect(cost).toBeCloseTo((1000 * 6.25 + 2000 * 10.0) / PER_M, 10);
  });

  it("charges 5m tokens once when only the 5m half is reported", () => {
    // The fallback read "no 1h figure, so assume the whole total was 1h" - which, next to a 5m
    // figure that was also charged, billed the same tokens twice and reported 2.6x the cost.
    const cost = costOf(usage({ cacheCreationInputTokens: 1000, cacheCreation5m: 1000 }));

    expect(cost).toBeCloseTo((1000 * 6.25) / PER_M, 10);
  });

  it("assumes the dearer rate when the response reports no split at all", () => {
    // Guessing 5m here would flatter the figure, and the figure is what the score line prints.
    const cost = costOf(usage({ cacheCreationInputTokens: 1000 }));

    expect(cost).toBeCloseTo((1000 * 10.0) / PER_M, 10);
  });

  it("charges 1h alone when the 5m half is reported as zero", () => {
    const cost = costOf(
      usage({ cacheCreationInputTokens: 10590, cacheCreation5m: 0, cacheCreation1h: 10590 })
    );

    expect(cost).toBeCloseTo((10590 * 10.0) / PER_M, 10);
  });
});

describe("the rest of the bill", () => {
  it("counts the uncached remainder, the output and the cache reads", () => {
    const cost = costOf(
      usage({ inputTokens: 500, outputTokens: 3000, cacheReadInputTokens: 10000 })
    );

    expect(cost).toBeCloseTo((500 * 5.0 + 3000 * 25.0 + 10000 * 0.5) / PER_M, 10);
  });

  it("refuses a model it has no rate for, rather than recording a silent zero", () => {
    expect(() => costOf(usage({ model: "claude-something-6" }))).toThrow(PricingError);
  });
});
