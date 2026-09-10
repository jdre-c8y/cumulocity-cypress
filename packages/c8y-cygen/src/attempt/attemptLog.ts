/**
 * The attempt log: append-only, one entry per iteration, kept in full for every run - green
 * ones included.
 *
 * It is load-bearing rather than bookkeeping. Sessions are stateless and fresh, and without this
 * they oscillate: flip a selector, fail, flip it back, fail, and burn the budget on a two-state
 * loop no single session can see.
 *
 * Sweeping green logs would destroy the design's only source of cost and flake data before that
 * data exists, so nothing here is pruned. Six entries of JSONL is too small to be worth deleting
 * and too valuable to lose.
 */
import fs from "node:fs";
import path from "node:path";
import type { SourceMap } from "../compiler/sourceMap.js";
import type { TripCondition } from "../ir/lintIr.js";
import type { FieldChange } from "../ir/patchDiff.js";
import type { IrDocument } from "../ir/types.js";
import { costOf, sumUsage, type UsageRecord } from "../pricing/modelPricing.js";

export type RunKind = "none" | "probe" | "spec";

export interface AttemptEntry {
  iteration: number;
  startedAt: string;
  mode: "probe" | "spec";
  /** The full IR this iteration authored. */
  ir: IrDocument;
  /** Computed from the diff, never claimed by the model. */
  changed: FieldChange[];
  /** Whether the diff was accepted, and why not when it was not. */
  verdict: "accepted" | "rejected";
  rejectReason?: string;
  /** What this iteration produced. "none" means the linter rejected before anything ran. */
  run: RunKind;
  runPassed?: boolean;
  runDurationMs?: number;
  /** The IR step the failure maps back to, via the source map. */
  failingStepPath?: string;
  /** Already truncated in the middle, with the location parsed off the untruncated text. */
  diagnostic?: string;
  screenshotPath?: string;
  sourceMap?: SourceMap;
  lintErrors?: string[];
  /** Which of the named stop conditions ended the run, when one did. */
  stopCondition?: TripCondition;
  usage?: UsageRecord;
  /**
   * A hash of the cached prefix. With the token counts this makes "why did this run cost more?"
   * answerable from the log alone - and it diagnoses the two invalidators nobody had considered:
   * cache isolation is per workspace, and a developer with uncommitted edits to the house-rules
   * file silently gets their own namespace.
   */
  prefixHash?: string;
  /**
   * Model turns, beside the run counter. The budget meters Cypress runs while cost accrues in
   * model turns, so a loop thrashing on lint rejections costs dollars and advances no run
   * counter. Counting it puts that in the same record.
   */
  modelTurns: number;
}

export class AttemptLog {
  private readonly entries: AttemptEntry[] = [];

  constructor(private readonly file: string) {}

  /** Reads what earlier iterations of this run wrote. A fresh session starts here. */
  static read(file: string): AttemptEntry[] {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as AttemptEntry);
  }

  load(): AttemptEntry[] {
    this.entries.length = 0;
    this.entries.push(...AttemptLog.read(this.file));
    return [...this.entries];
  }

  append(entry: AttemptEntry): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Appended as it happens: a run that fails must still leave its log, so a failed run is data
    // rather than a wasted afternoon.
    fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
    this.entries.push(entry);
  }

  all(): AttemptEntry[] {
    return [...this.entries];
  }

  get length(): number {
    return this.entries.length;
  }
}

/**
 * What a fresh session is told about the ones before it. Not the transcripts - that would
 * reintroduce the accumulating context in its worst form, as verbatim wrong reasoning.
 */
export function summariseAttempts(entries: AttemptEntry[]): string {
  if (entries.length === 0) return "No earlier iteration in this run.";
  const lines = entries.map((e) => {
    const changed = e.changed.length === 0 ? "(no change)" : e.changed.map((c) => c.path).join(", ");
    const outcome =
      e.verdict === "rejected"
        ? `REJECTED: ${e.rejectReason ?? "diff reached a frozen field"}`
        : e.run === "none"
          ? `lint failed: ${(e.lintErrors ?? []).slice(0, 3).join(" | ")}`
          : e.runPassed
            ? `${e.run} run passed`
            : `${e.run} run failed at ${e.failingStepPath ?? "an unmapped line"}`;
    return `iteration ${e.iteration} [${e.mode}] changed ${changed} -> ${outcome}`;
  });
  return lines.join("\n");
}

export interface RunTotals {
  iterations: number;
  modelTurns: number;
  probeRuns: number;
  specRuns: number;
  totalRuns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /**
   * Start-to-start gaps between Cypress runs, in milliseconds. The whole one-hour TTL decision
   * turns on whether this exceeds five minutes, and there was no clock anywhere in v1.
   */
  runGapsMs: number[];
}

export function totals(entries: AttemptEntry[]): RunTotals {
  const usages = entries.map((e) => e.usage).filter((u): u is UsageRecord => Boolean(u));
  const summed = sumUsage(usages);
  const runStarts = entries
    .filter((e) => e.run !== "none")
    .map((e) => Date.parse(e.startedAt))
    .filter((t) => !Number.isNaN(t));

  return {
    iterations: entries.length,
    modelTurns: entries.reduce((n, e) => n + e.modelTurns, 0),
    probeRuns: entries.filter((e) => e.run === "probe").length,
    specRuns: entries.filter((e) => e.run === "spec").length,
    totalRuns: entries.filter((e) => e.run !== "none").length,
    ...summed,
    runGapsMs: runStarts.slice(1).map((t, i) => t - (runStarts[i] as number)),
  };
}

export function formatCost(entry: AttemptEntry): string {
  if (!entry.usage) return "no model call";
  return `$${costOf(entry.usage).toFixed(4)} (table ${entry.usage.priceTableVersion})`;
}
