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
  if (input.lint && (input.lint.errors.length > 0 || input.lint.gaps.length > 0)) {
    tail.push({
      text: [
        "# What the linter says about the current IR",
        "",
        ...input.lint.errors.map((e) => `ERROR ${e.where}: ${e.message}`),
        ...input.lint.gaps.map((g) => `STILL MISSING ${g.need} at ${g.at}: ${g.hint}`),
      ].join("\n"),
    });
  }
  if (input.lastDiagnostic) {
    tail.push({ text: `# The last Cypress failure\n\n\`\`\`\n${input.lastDiagnostic}\n\`\`\`` });
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
