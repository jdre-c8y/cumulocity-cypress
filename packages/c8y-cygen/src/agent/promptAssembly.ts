/**
 * Prompt assembly, and the three cache breakpoints.
 *
 * Three genuine stability tiers, so three explicit markers rather than one automatic one:
 *
 *   BP1  last system block   tools + system: house rules, domain notes, the conventions span,
 *                            the IR schema                                          1h TTL
 *   BP2  first user message  the scenario contract                                  1h TTL
 *   BP3  end of that message the IR, facts, diagnostic, attempt log, progress line  5m TTL
 *
 * Longer-lived entries must come before shorter-lived ones, which BP1 -> BP2 -> BP3 satisfies.
 *
 * The named worry - house rules read live from the target repo - is not the hazard. The file is
 * committed at a fixed path, so at one commit its bytes are identical on every read. The hazard
 * is *normalisation*: a trailing-newline trim or a markdown re-render between read and send
 * makes the bytes a function of the code path. Read once per process, pass verbatim.
 *
 * The trap worth naming: the progress line reads like an instruction, so it is tempting to put
 * it in the system block - where it would invalidate the whole prefix every iteration. It is
 * per-iteration state. It goes in the tail.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { stringify as toYaml } from "yaml";
import { readPackageAsset } from "../support/assets.js";
import { irSchemaBytes } from "../ir/lintIr.js";
import { summariseFacts } from "../probe/readFacts.js";
import { summariseAttempts, type AttemptEntry } from "../attempt/attemptLog.js";
import type { EffectiveConventions } from "../conventions/types.js";
import type { ScenarioContract } from "../contract/scenarioContract.js";
import type { FactsDocument } from "../facts/types.js";
import type { LintResult } from "../ir/lintIr.js";
import type { IrDocument } from "../ir/types.js";
import type { HealRung } from "../run/healLadder.js";

export interface PromptBlock {
  text: string;
  /** Set on the last block of a tier. */
  cache?: { ttl: "5m" | "1h" };
}

export interface AssembledPrompt {
  system: PromptBlock[];
  /** The scenario-contract span, cached at 1h because it is stable for the whole scenario. */
  contract: PromptBlock;
  /** Everything that changes per iteration. */
  tail: PromptBlock[];
  /** A hash of the BP1 span, recorded in every attempt-log entry. */
  prefixHash: string;
}

/**
 * What a heal turn tells the model. Ticket 11 fixed the rungs; this carries which one is in
 * force, the step the source map named, and the reason a previous diff was refused.
 */
export interface HealTurn {
  rung: HealRung;
  failingStepPath?: string;
  /** Set on the one re-prompt a rejected diff gets before the run stops and asks a human. */
  rejectedReason?: string;
}

export interface PromptInput {
  contract: ScenarioContract;
  conventions: EffectiveConventions;
  /** Read live from the target repo, once per process, and passed verbatim. */
  houseRules: string;
  ir: IrDocument | null;
  facts: FactsDocument | null;
  lint: LintResult | null;
  attempts: AttemptEntry[];
  lastDiagnostic?: string;
  progressLine: string;
  /** The style the run will actually generate in, which may not be the contract's. */
  effectiveStyle: "integration" | "mocked";
  styleNote?: string;
  /** Absent on a generation turn. Present only after a spec run has failed. */
  heal?: HealTurn;
}

/**
 * The rung's rules, stated where the model reads them rather than left to a house-rules file
 * it may not have. The frozen list is repeated here on purpose: healing is authoring under
 * pressure to turn a red thing green, and the cheapest available fix is always to assert less.
 */
function healBlock(heal: HealTurn): string {
  const lines = [
    "# The spec run failed, and this is a heal turn",
    "",
    heal.failingStepPath
      ? `The failure maps back to \`${heal.failingStepPath}\`.`
      : "The failure mapped back to no step, so the source map could not name one. Read the diagnostic.",
    "",
  ];

  if (heal.rung === "patch") {
    lines.push(
      "Rung 1 of 2: PATCH. No new observation is available, so you may only re-arrange facts a",
      "probe has already collected.",
      "",
      "You may:",
      "  - re-point this step, or one upstream of it, at a different candidate row the probe",
      "    already observed - moving `fromRow`, and the `resolved` the ladder derives from it",
      "  - change a `within` scope or an index",
      "  - insert a step, including a settle before the failing one",
      "",
      "You may not:",
      "  - author a selector. You never author a selector, and here least of all: name a row",
      "    and the ladder derives the selector from it. A diff that writes one is rejected.",
      "  - change what a step asserts - extractor, comparator, operand, cardinality, outcome",
      "    ids - or delete a step. Those are frozen on a heal turn. The cheapest way to turn a",
      "    red thing green is to assert less, and that is the one thing this tool must not do.",
      "",
      "If no row the probe observed fits, do not guess. Put the target back to `provisional`",
      "and the next run re-observes it. That spends a probe run instead of a spec run, which is",
      "the cheaper mistake."
    );
  } else {
    lines.push(
      "Rung 2 of 2: RE-PROBE. The patch did not work, so the facts on hand are not enough, and",
      "new observation is the only legal way to learn anything new.",
      "",
      "Put the failing step's target back to `provisional`, and add collect points at that step",
      "and after it. The run compiles in probe mode, re-observes, and the ladder resolves the",
      "selector again. Leave every assertion exactly as it is."
    );
  }

  if (heal.rejectedReason) {
    lines.push(
      "",
      `Your last diff was rejected: ${heal.rejectedReason}`,
      "",
      "This is your last attempt at this failure. One rejected diff is re-prompted; a second",
      "stops the run and asks a human."
    );
  }

  lines.push(
    "",
    "If the application genuinely contradicts the scenario - the page shows one thing and the",
    "contract asks for another - do not patch around it. Reply with this instead of an IR:",
    "",
    '    {"assist": {"why": "<what a human must decide>"}}'
  );

  return lines.join("\n");
}

/**
 * The house rules the target repo maintains. Read live so they cannot drift, cached per process
 * so the bytes are a function of the file rather than of how often it was read.
 */
const houseRulesCache = new Map<string, string>();

export function readHouseRules(targetRepo: string): string {
  const file = path.join(
    path.resolve(targetRepo),
    ".claude",
    "rules",
    "e2e-tests.instructions.md"
  );
  const cached = houseRulesCache.get(file);
  if (cached !== undefined) return cached;
  const bytes = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  houseRulesCache.set(file, bytes);
  return bytes;
}

export function domainNotes(): string {
  return readPackageAsset("agent/domain-notes.md");
}

/**
 * Only the model-facing span of the conventions file. Style goes to the compiler and is never
 * shown; the reachability index is looked up by route and never dumped. Those two are the
 * largest artifacts, and keeping them out is worth more than anything else here.
 */
export function conventionsForModel(conventions: EffectiveConventions): string {
  return toYaml({
    repo: conventions.repo,
    testDataPrefix: conventions.testDataPrefix,
    blessedMoves: conventions.commands.blessed.map((m) => ({
      name: m.name,
      signature: m.signature,
      kind: m.kind,
      role: m.role,
      pairsWith: m.pairsWith,
      fabricates: m.fabricates,
    })),
    withheld: conventions.commands.withheld,
    valueBuilders: conventions.effectiveValueBuilders.map((b) => ({
      id: b.id,
      emit: b.emit,
      prefixConvention: b.prefixConvention,
      keys: b.keys,
    })),
    deniedValueBuilders: conventions.deniedValueBuilders,
    apiSetup: conventions.apiSetup?.prefer,
  });
}

export function assemblePrompt(input: PromptInput): AssembledPrompt {
  const system: PromptBlock[] = [
    { text: domainNotes() },
    { text: `# The target repo's own house rules for e2e tests\n\n${input.houseRules}` },
    {
      text: `# The blessed vocabulary of ${input.conventions.repo}\n\n\`\`\`yaml\n${conventionsForModel(input.conventions)}\`\`\``,
    },
    // The schema ships as the literal bytes on disk. Rebuilding it here would make the cache key
    // a function of key order, and a changed tool or schema is the one invalidation with no
    // cache-preserving escape hatch.
    {
      text: `# The IR schema\n\n\`\`\`json\n${irSchemaBytes()}\`\`\``,
      cache: { ttl: "1h" },
    },
  ];

  const contractBlock: PromptBlock = {
    text: [
      `# The scenario contract: ${input.contract.contractPath}`,
      "",
      input.contract.raw,
      "",
      `Generate this in **${input.effectiveStyle}** style.`,
      input.styleNote ? `(${input.styleNote})` : "",
    ]
      .filter((l) => l !== "")
      .join("\n"),
    cache: { ttl: "1h" },
  };

  const tail: PromptBlock[] = [];
  tail.push({
    text: input.ir
      ? `# The current IR\n\n\`\`\`json\n${JSON.stringify(input.ir, null, 2)}\n\`\`\``
      : "# The current IR\n\nThere is none yet. This is the first iteration.",
  });
  tail.push({
    text: input.facts
      ? `# Facts a probe observed\n\n\`\`\`\n${summariseFacts(input.facts)}\n\`\`\``
      : "# Facts a probe observed\n\nNone yet. No probe has run, so no selector can be resolved and the spec IR cannot lint.",
  });
  const lintHasSomethingToSay =
    input.lint &&
    (input.lint.errors.length > 0 ||
      input.lint.gaps.length > 0 ||
      input.lint.stubSatisfied.length > 0);
  if (input.lint && lintHasSomethingToSay) {
    tail.push({
      text: [
        "# What the linter says about the current IR",
        "",
        ...input.lint.errors.map((e) => `ERROR ${e.where}: ${e.message}`),
        ...input.lint.gaps.map((g) => `STILL MISSING ${g.need} at ${g.at}: ${g.hint}`),
        // Not an error and not a gap. It is a nudge with a reason, shown because the model is
        // the only party that can still choose a different subject to assert against.
        ...input.lint.stubSatisfied.map(
          (x) =>
            `NOTE outcome ${x.outcome} asserts '${x.via}', which a stub in this same ` +
            `test wrote into a fabricated response. Legal. Where you can satisfy this outcome ` +
            `by asserting something the application derived instead, prefer that.`
        ),
      ].join("\n"),
    });
  }
  if (input.lastDiagnostic) {
    tail.push({ text: `# The last Cypress failure\n\n\`\`\`\n${input.lastDiagnostic}\n\`\`\`` });
  }
  // Straight after the failure, so the model reads what broke and then what it may do about it.
  if (input.heal) {
    tail.push({ text: healBlock(input.heal) });
  }
  tail.push({
    text: `# What earlier iterations of this run tried\n\n${summariseAttempts(input.attempts)}`,
  });
  tail.push({
    text: [
      `# Progress`,
      "",
      input.progressLine,
      "",
      "Author the whole IR for the next iteration. Reply with exactly one fenced ```json block",
      "holding the complete IR document and nothing else outside it.",
    ].join("\n"),
    cache: { ttl: "5m" },
  });

  return {
    system,
    contract: contractBlock,
    tail,
    prefixHash: hashBlocks(system),
  };
}

export function hashBlocks(blocks: PromptBlock[]): string {
  const hash = createHash("sha256");
  for (const block of blocks) hash.update(block.text);
  return hash.digest("hex").slice(0, 16);
}
