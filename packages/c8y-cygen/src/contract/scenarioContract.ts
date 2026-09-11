/**
 * The contract reader. Scenario contract markdown in, a parsed contract out.
 *
 * Only Expected Outcomes and Style are read for meaning; the other four sections are
 * handed to the model as prose. Unknown `##` sections and HTML comments pass through
 * untouched and are ignored deliberately - that is where the authoring interview's
 * questions and answers live.
 */

export type ContractStyle = "integration" | "mocked";

export interface ExpectedOutcome {
  /** The number the author wrote. Outcomes are addressed by it, never by prose. */
  id: number;
  text: string;
}

export interface PassthroughSection {
  heading: string;
  body: string;
}

export interface ScenarioContract {
  contractPath: string;
  title: string;
  objective: string;
  preconditions: string;
  setup: string;
  steps: string;
  outcomes: ExpectedOutcome[];
  /** null when the author did not write a Style section. */
  style: ContractStyle | null;
  /**
   * Grep tags for the emitted `it`, as the author declared them. Empty when they declared none.
   *
   * Not derived, and not the model's to guess. Measured across the host repo's 203 spec files,
   * `@requiresBackend` correlates with neither real-state calls in the test body nor with
   * integration style - the latter at 44%, worse than a coin. It is a judgement about the
   * scenario that only its author holds, and getting it wrong runs the spec in the wrong CI
   * lane, which is a failure no assertion in the spec can catch.
   */
  tags: string[];
  passthrough: PassthroughSection[];
  /** The contract exactly as written. The anchoring check reads literals out of this. */
  raw: string;
}

export class ContractParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractParseError";
  }
}

const KNOWN_SECTIONS = [
  "objective",
  "preconditions",
  "setup",
  "steps",
  "expected outcomes",
  "style",
  "tags",
] as const;

const STYLES: readonly string[] = ["integration", "mocked"];

/**
 * Blanks the body of every HTML comment, keeping the line count and the length of the
 * document identical so offsets still line up. A `##` inside a comment is then invisible
 * to the heading scanner while the comment itself survives in `raw` and in the section
 * bodies the model is shown.
 */
function maskComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, (m) =>
    m.replace(/[^\n]/g, " ")
  );
}

interface Section {
  heading: string;
  body: string;
}

function splitSections(src: string): { title: string; sections: Section[] } {
  const masked = maskComments(src);
  const lines = src.split("\n");
  const maskedLines = masked.split("\n");

  let title = "";
  const sections: Section[] = [];
  let current: { heading: string; from: number } | null = null;

  const close = (to: number) => {
    if (!current) return;
    sections.push({
      heading: current.heading,
      body: lines.slice(current.from, to).join("\n").trim(),
    });
  };

  maskedLines.forEach((line, i) => {
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) {
      close(i);
      current = null;
      title = (lines[i] ?? "").replace(/^#\s+/, "").trim();
      return;
    }
    const h2 = /^##\s+(.*)$/.exec(line);
    if (!h2) return;
    close(i);
    current = { heading: (lines[i] ?? "").replace(/^##\s+/, "").trim(), from: i + 1 };
  });
  close(lines.length);

  return { title: title.replace(/^Scenario:\s*/i, "").trim(), sections };
}

/**
 * Numbered list items, each item's written number becoming its id. Continuation lines are
 * joined so that an outcome wrapped across two lines is one outcome and not two.
 */
function parseOutcomes(body: string): ExpectedOutcome[] {
  const outcomes: ExpectedOutcome[] = [];
  for (const line of body.split("\n")) {
    const start = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (start) {
      outcomes.push({ id: Number(start[1]), text: (start[2] ?? "").trim() });
      continue;
    }
    const last = outcomes[outcomes.length - 1];
    if (last && line.trim()) last.text = `${last.text} ${line.trim()}`;
  }
  return outcomes;
}

/**
 * Tolerates the two shapes an author writes by hand - a markdown list, or one comma-separated
 * line - and backticks around each tag either way. A token with no leading `@` is refused
 * rather than repaired: `requiresBackend` is a plausible typo for a real tag, and silently
 * emitting it would put the spec in a lane nobody greps.
 */
function parseTags(body: string | undefined, contractPath: string): string[] {
  if (body === undefined) return [];
  // Comments go first. This is the one section parser that refuses what it does not recognise,
  // and the module promises comments pass through - so a contract saying "no tag, and here is
  // why" has to parse.
  const lines = body.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const items = lines.filter((l) => /^\s*[-*]\s+/.test(l));
  // List items win when there are any, so an author may explain the section above them without
  // every sentence being read as a tag. But a stray line that carries a tag is refused rather
  // than skipped: dropping one silently is the wrong-CI-lane failure this section exists to
  // prevent, and it would look exactly like success.
  if (items.length > 0) {
    const stray = lines.find((l) => !/^\s*[-*]\s+/.test(l) && l.includes("@"));
    if (stray !== undefined) {
      throw new ContractParseError(
        `${contractPath}: '${stray.trim()}' in '## Tags' carries a tag but is not a list item. Every tag must be its own '- ' item, or the section must be one comma-separated line.`
      );
    }
  }
  const source = items.length > 0 ? items : lines;
  const tokens = source
    .flatMap((line) => line.split(","))
    .map((token) => token.replace(/^\s*[-*]\s*/, "").replace(/`/g, "").trim())
    .filter((t) => t.length > 0);
  for (const token of tokens) {
    if (!/^@[\w-]+$/.test(token)) {
      throw new ContractParseError(
        `${contractPath}: '${token}' in '## Tags' is not a grep tag. Write it as it appears in the spec, leading @ and all.`
      );
    }
  }
  return tokens;
}

function parseStyle(body: string): ContractStyle {
  const token = /`([^`]+)`/.exec(body)?.[1] ?? body.trim().split(/\s+/)[0] ?? "";
  const value = token.trim().toLowerCase();
  if (!STYLES.includes(value)) {
    throw new ContractParseError(
      `Style is '${token}', which is not one of: ${STYLES.join(", ")}.`
    );
  }
  return value as ContractStyle;
}

export function parseScenarioContract(
  source: string,
  contractPath: string
): ScenarioContract {
  const { title, sections } = splitSections(source);

  const known = new Map<string, string>();
  const passthrough: PassthroughSection[] = [];
  for (const s of sections) {
    const key = s.heading.toLowerCase();
    if ((KNOWN_SECTIONS as readonly string[]).includes(key)) known.set(key, s.body);
    else passthrough.push(s);
  }

  const outcomesBody = known.get("expected outcomes");
  if (outcomesBody === undefined) {
    throw new ContractParseError(
      `${contractPath}: no '## Expected Outcomes' section. Without it there is nothing to score.`
    );
  }
  const outcomes = parseOutcomes(outcomesBody);
  if (outcomes.length === 0) {
    throw new ContractParseError(
      `${contractPath}: '## Expected Outcomes' holds no numbered items.`
    );
  }
  const duplicate = outcomes.find(
    (o, i) => outcomes.findIndex((x) => x.id === o.id) !== i
  );
  if (duplicate) {
    throw new ContractParseError(
      `${contractPath}: Expected Outcome ${duplicate.id} is numbered twice; outcomes are addressed by number.`
    );
  }

  const styleBody = known.get("style");

  return {
    contractPath,
    title,
    objective: known.get("objective") ?? "",
    preconditions: known.get("preconditions") ?? "",
    setup: known.get("setup") ?? "",
    steps: known.get("steps") ?? "",
    outcomes,
    style: styleBody === undefined ? null : parseStyle(styleBody),
    tags: parseTags(known.get("tags"), contractPath),
    passthrough,
    raw: source,
  };
}
