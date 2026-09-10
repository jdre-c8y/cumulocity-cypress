import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AttemptLog, summariseAttempts, totals, type AttemptEntry } from "./attemptLog.js";
import { PRICE_TABLE_VERSION, PricingError, costOf, promptTokens, ratesFor } from "../pricing/modelPricing.js";
import { b0Ir } from "../testing/b0.js";

const usage = {
  inputTokens: 2_000,
  outputTokens: 3_000,
  cacheReadInputTokens: 10_000,
  cacheCreationInputTokens: 0,
  priceTableVersion: PRICE_TABLE_VERSION,
  model: "claude-opus-5",
};

function entry(over: Partial<AttemptEntry> = {}): AttemptEntry {
  return {
    iteration: 1,
    startedAt: "2026-09-09T10:00:00.000Z",
    mode: "spec",
    ir: b0Ir(),
    changed: [],
    verdict: "accepted",
    run: "spec",
    runPassed: true,
    modelTurns: 1,
    usage,
    ...over,
  };
}

describe("pricing", () => {
  it("computes dollars from a pinned table rather than from a response field", () => {
    // 2000 input at $5, 3000 output at $25, 10000 cache reads at $0.50, per million.
    expect(costOf(usage)).toBeCloseTo(0.01 + 0.075 + 0.005, 6);
  });

  it("counts the whole prompt, not the uncached remainder", () => {
    // Logging input_tokens alone under-reports by the entire prefix, which is exactly what makes
    // a cost record look implausibly cheap.
    expect(promptTokens(usage)).toBe(12_000);
    expect(promptTokens(usage)).toBeGreaterThan(usage.inputTokens);
  });

  it("charges a one-hour cache write at twice base input, not at the five-minute rate", () => {
    const rates = ratesFor("claude-opus-5");

    expect(rates.cacheWrite1h).toBeCloseTo(rates.input * 2);
    expect(rates.cacheWrite5m).toBeCloseTo(rates.input * 1.25);
    expect(rates.cacheRead).toBeCloseTo(rates.input * 0.1);
  });

  it("stops rather than silently recording a zero for a model it has no rate for", () => {
    expect(() => costOf({ ...usage, model: "claude-opus-5-20260401" })).toThrow(PricingError);
  });

  it("records the price-table version, so a rate change cannot rewrite history", () => {
    expect(usage.priceTableVersion).toBe(PRICE_TABLE_VERSION);
  });
});

describe("the attempt log", () => {
  function withLog(run: (log: AttemptLog, file: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cygen-log-"));
    const file = path.join(dir, "attempts.jsonl");
    try {
      run(new AttemptLog(file), file);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("appends as it happens, so a run that fails still leaves its log", () => {
    withLog((log, file) => {
      log.append(entry({ iteration: 1, run: "probe", runPassed: true }));
      log.append(entry({ iteration: 2, run: "spec", runPassed: false }));

      expect(AttemptLog.read(file)).toHaveLength(2);
    });
  });

  it("is what a fresh session reads to see what earlier ones tried", () => {
    withLog((log) => {
      log.append(
        entry({
          iteration: 1,
          run: "spec",
          runPassed: false,
          failingStepPath: "steps[6]",
          changed: [
            { path: "steps.check-source.settle.timeoutMs", before: undefined, after: 20000 },
          ],
        })
      );

      const summary = summariseAttempts(log.all());

      expect(summary).toContain("iteration 1");
      expect(summary).toContain("steps.check-source.settle.timeoutMs");
      expect(summary).toContain("failed at steps[6]");
    });
  });

  it("shows a rejected diff, which is the evidence a model wanted to weaken an assertion", () => {
    const summary = summariseAttempts([
      entry({ verdict: "rejected", rejectReason: "cardinality is frozen", run: "none" }),
    ]);

    expect(summary).toContain("REJECTED: cardinality is frozen");
  });

  it("counts model turns beside Cypress runs, so lint thrash is visible in the same record", () => {
    // The budget meters runs while cost accrues in turns. A loop rejected by the linter costs
    // dollars and advances no run counter.
    const t = totals([
      entry({ iteration: 1, run: "none", modelTurns: 1 }),
      entry({ iteration: 2, run: "none", modelTurns: 1 }),
      entry({ iteration: 3, run: "probe", modelTurns: 1 }),
    ]);

    expect(t.totalRuns).toBe(1);
    expect(t.modelTurns).toBe(3);
    expect(t.costUsd).toBeGreaterThan(0);
  });

  it("measures the start-to-start gap between Cypress runs, which no clock ever did", () => {
    const t = totals([
      entry({ iteration: 1, run: "probe", startedAt: "2026-09-09T10:00:00.000Z" }),
      entry({ iteration: 2, run: "none", startedAt: "2026-09-09T10:02:00.000Z" }),
      entry({ iteration: 3, run: "spec", startedAt: "2026-09-09T10:07:30.000Z" }),
    ]);

    expect(t.runGapsMs).toEqual([450_000]);
    expect(t.runGapsMs[0]).toBeGreaterThan(5 * 60_000);
  });

  it("separates probe runs from total runs, because the two caps are separate", () => {
    const t = totals([
      entry({ iteration: 1, run: "probe" }),
      entry({ iteration: 2, run: "spec" }),
      entry({ iteration: 3, run: "spec" }),
    ]);

    expect(t.probeRuns).toBe(1);
    expect(t.specRuns).toBe(2);
    expect(t.totalRuns).toBe(3);
  });
});
