/**
 * Dollars are computed client-side from a pinned table.
 *
 * There is no cost field on a response, and the Usage and Cost Admin API cannot serve this: it
 * is org-wide, lagged, and a key shared across projects blends their traffic. So the attempt log
 * records **raw counts plus the price-table version** - otherwise a rate change silently rewrites
 * history and a cumulative figure stops being comparable across time.
 *
 * The cautionary case is v1's table: one model, an alias mismatch that yielded "no pricing on
 * file", and an introductory rate that expired underneath it.
 */

/** Bump this whenever a rate below changes. Every attempt-log entry records it. */
export const PRICE_TABLE_VERSION = "2026-06-24";

export interface ModelRates {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/**
 * Cache reads cost 0.1x base input; cache writes 1.25x for the 5-minute TTL and 2x for the
 * 1-hour one. Those multipliers are why the TTL choice turns on the start-to-start gap between
 * requests rather than on taste.
 */
export const PRICES: Record<string, ModelRates> = {
  "claude-opus-5": {
    input: 5.0,
    output: 25.0,
    cacheRead: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
  },
  "claude-sonnet-5": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.2,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4.0,
  },
};

/**
 * `input_tokens` is the uncached remainder only. Logging it alone under-reports by the whole
 * prefix, which is the exact mistake that makes a cost record look implausibly cheap.
 */
export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** The split the response reports, when it does. Kept because the two rates differ. */
  cacheCreation5m?: number;
  cacheCreation1h?: number;
  /** Separates thinking from IR-authoring tokens, so "is high effort paying for itself?" is answerable from the log. */
  thinkingTokens?: number;
  priceTableVersion: string;
  model: string;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

export function ratesFor(model: string): ModelRates {
  const rates = PRICES[model];
  if (!rates) {
    throw new PricingError(
      `No pricing on file for '${model}' at price table ${PRICE_TABLE_VERSION}. A missing rate must stop rather than silently record a zero.`
    );
  }
  return rates;
}

const PER_TOKEN = 1_000_000;

export function costOf(usage: UsageRecord): number {
  const rates = ratesFor(usage.model);
  // When the response reports the TTL split, use it. Otherwise assume the more expensive of the
  // two rather than flattering the figure.
  const write1h = usage.cacheCreation1h ?? usage.cacheCreationInputTokens;
  const write5m = usage.cacheCreation5m ?? 0;

  return (
    (usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheReadInputTokens * rates.cacheRead +
      write5m * rates.cacheWrite5m +
      write1h * rates.cacheWrite1h) /
    PER_TOKEN
  );
}

/** Total prompt size is the three input fields summed, never `input_tokens` alone. */
export function promptTokens(usage: UsageRecord): number {
  return (
    usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
  );
}

export function sumUsage(records: UsageRecord[]): {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
} {
  return records.reduce(
    (acc, u) => ({
      costUsd: acc.costUsd + costOf(u),
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cacheReadInputTokens: acc.cacheReadInputTokens + u.cacheReadInputTokens,
      cacheCreationInputTokens:
        acc.cacheCreationInputTokens + u.cacheCreationInputTokens,
    }),
    {
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    }
  );
}
