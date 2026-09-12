/**
 * What turns a Cypress failure into an IR step.
 *
 * A sidecar keyed by emitted line *range*, whose value is a step path. A range and not a line,
 * because the emitted spec has multi-line chains and a failure inside one names the
 * `.should(...)` line, not the `cy.get(...)` line that opens it.
 *
 * One IR step compiles to exactly one statement, never two steps to one - otherwise a range has
 * two owners exactly where the map is needed.
 *
 * It is a build artifact and the committed spec is not touched, so house-style fidelity is
 * unaffected. It is kept in the attempt log so that it survives an assist.
 */
import { createHash } from "node:crypto";

export interface SourceMapEntry {
  /** 1-based, inclusive. */
  fromLine: number;
  toLine: number;
  /** `steps[7]`, or `setup[0]`. */
  stepPath: string;
  stepId: string;
  /** The Expected Outcomes this statement satisfies. A lookup, not new data. */
  outcomes: number[];
}

export interface SourceMap {
  specPath: string;
  /**
   * Of the emitted file, recorded in `sourcemap.json` beside the run. Recorded, not checked:
   * the map is rebuilt from the file every time it is used, so there is nothing here to catch.
   * It said "so a stale map is caught rather than trusted" beside a checker nothing called.
   */
  contentHash: string;
  entries: SourceMapEntry[];
  /**
   * Step ids the anchoring could not locate in the formatted file. Reported rather than
   * swallowed: without it, a step the map lost is indistinguishable from a step that asserts
   * nothing, and the scorer would blame the spec for a defect in the map.
   */
  unanchored: string[];
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** A statement as the compiler emitted it, before the repo's formatter has had its say. */
export interface EmittedStatement {
  stepPath: string;
  stepId: string;
  outcomes: number[];
  /** The emitted text, possibly several lines. */
  text: string;
}

const strip = (line: string): string => line.replace(/[\s'"`]/g, "");

/**
 * Where the last statement's range may run to. Not the end of the file: the closing braces of
 * the `it`, the `describe` and any `.then` belong to no statement, and a range that swallows
 * them credits the last step with every assertion emitted after it. `stepAtLine` needs no help
 * from the extra span - it already falls back to the nearest preceding entry - but axis B reads
 * these ranges to decide which outcome a `.should(` belongs to.
 */
function lastMeaningfulLine(lines: string[]): number {
  let i = lines.length - 1;
  while (i > 0 && /^[\s)}\];,]*$/.test(lines[i] as string)) i--;
  return i;
}

/**
 * Anchors the statements against the *formatted* file.
 *
 * The formatter runs after emission, so line numbers computed before it are wrong. The
 * formatter does not reorder or merge statements, though, so a sequential scan for each
 * statement's opening token is enough - and it stays correct when the formatter breaks a chain
 * across lines or flips a quote, which is exactly what it does.
 */
export function buildSourceMap(
  specPath: string,
  formatted: string,
  statements: EmittedStatement[]
): SourceMap {
  const lines = formatted.split("\n");
  const starts: number[] = [];
  let cursor = 0;

  for (const statement of statements) {
    const anchor = strip((statement.text.split("\n")[0] ?? "")).slice(0, 12);
    let found = -1;
    for (let i = cursor; i < lines.length; i++) {
      if (anchor.length > 0 && strip(lines[i] as string).startsWith(anchor)) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      // Better an honest gap than a confident wrong range: an unanchored statement gets no
      // entry, and stepAtLine falls back to the nearest preceding one.
      starts.push(-1);
      continue;
    }
    starts.push(found);
    cursor = found + 1;
  }

  const entries: SourceMapEntry[] = [];
  const unanchored: string[] = [];
  for (let i = 0; i < statements.length; i++) {
    const start = starts[i] as number;
    if (start < 0) {
      unanchored.push((statements[i] as EmittedStatement).stepId);
      continue;
    }
    let end = lastMeaningfulLine(lines);
    for (let j = i + 1; j < statements.length; j++) {
      const next = starts[j] as number;
      if (next >= 0) {
        end = next - 1;
        break;
      }
    }
    const statement = statements[i] as EmittedStatement;
    entries.push({
      fromLine: start + 1,
      toLine: Math.max(start + 1, end + 1),
      stepPath: statement.stepPath,
      stepId: statement.stepId,
      outcomes: statement.outcomes,
    });
  }

  return { specPath, contentHash: hashContent(formatted), entries, unanchored };
}

export function stepAtLine(map: SourceMap, line: number): SourceMapEntry | undefined {
  const containing = map.entries.find((e) => line >= e.fromLine && line <= e.toLine);
  if (containing) return containing;
  const preceding = map.entries.filter((e) => e.fromLine <= line);
  return preceding[preceding.length - 1];
}
