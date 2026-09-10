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
    passthrough,
    raw: source,
  };
}
