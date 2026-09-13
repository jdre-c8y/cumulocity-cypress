/**
 * A manual loop over the messages endpoint. Not the Tool Runner, and not the Agent SDK.
 *
 * The Tool Runner signals iteration-budget exhaustion with a bare break and keeps its count in a
 * private field with no accessor, so a build on it cannot tell "the model finished" from "the
 * runner gave up" - a distinction both the budget and the stop conditions require. It would have
 * to count iterations itself, at which point the only thing left is the tool loop, and there are
 * no tools here.
 *
 * The Agent SDK is out on two independent grounds: it exposes no cache-control API at all, which
 * forecloses the three breakpoints; and it ships filesystem and shell tools on by default,
 * against a design whose entire safety argument is a closed surface. An agent with Write bypasses
 * the compiler; an agent with Bash runs Cypress outside a budget denominated in Cypress runs.
 *
 * There are no tools here at all. The harness runs Cypress: under a run-denominated budget, a
 * model-callable run is a model-callable budget, and the anti-gaming guard needs the tool rather
 * than the model to observe the result.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { ModelError, type AuthorIrRequest, type AuthorIrResult, type CallsModel } from "./callsModel.js";
import { PRICE_TABLE_VERSION, type UsageRecord } from "../pricing/modelPricing.js";
import type { PromptBlock } from "./promptAssembly.js";

/**
 * Pinned. Tiered effort is structurally unavailable - an effort change always invalidates the
 * cache and the per-message escape hatch is useless across process boundaries - which
 * reinforces the one-model decision with a mechanical reason rather than a prudential one.
 */
export const MODEL = "claude-opus-5";
export const EFFORT = "high" as const;
/**
 * Raised from 16,000, which B1's first live run walked into three iterations running: a
 * cost-10 scenario's IR is several times a cost-1 scenario's, and at the old cap the document
 * was cut off mid-write every time. The failure was expensive precisely because it was not
 * legible - see parseIrReply, which now names truncation when the stop reason says so.
 */
export const MAX_TOKENS = 32_000;

/** A 1000x660 Cypress viewport is 864 visual tokens. A tall full-page capture is 3,888 and is
 *  not auto-downscaled, sitting just under the cap that would trigger it. So it is capped here. */
const MAX_SCREENSHOT_BYTES = 1_500_000;

type SystemParam = Anthropic.TextBlockParam[];
type ContentParam = Anthropic.ContentBlockParam[];

function toBlock(block: PromptBlock): Anthropic.TextBlockParam {
  if (!block.cache) return { type: "text", text: block.text };
  return {
    type: "text",
    text: block.text,
    cache_control:
      block.cache.ttl === "1h"
        ? { type: "ephemeral", ttl: "1h" }
        : { type: "ephemeral" },
  };
}

function screenshotBlock(file: string): Anthropic.ImageBlockParam | null {
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength > MAX_SCREENSHOT_BYTES) return null;
  const ext = path.extname(file).toLowerCase();
  const mediaType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") },
  };
}

export class AnthropicModel implements CallsModel {
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async authorIr(request: AuthorIrRequest): Promise<AuthorIrResult> {
    const system: SystemParam = request.prompt.system.map(toBlock);

    // One user message. The contract span carries BP2 and the per-iteration tail carries BP3, so
    // the three markers sit at the three real stability boundaries.
    const content: ContentParam = [toBlock(request.prompt.contract)];
    if (request.screenshotPath) {
      const image = screenshotBlock(request.screenshotPath);
      if (image) content.push(image);
    }
    content.push(...request.prompt.tail.map(toBlock));

    // Streamed, and not for progress reporting - nothing reads the chunks. The SDK refuses a
    // non-streaming request whose estimated duration exceeds ten minutes, and that estimate
    // scales with max_tokens, so raising the cap to 32,000 made every call throw before it was
    // sent. `.finalMessage()` yields the same Message the non-streaming call did, so the stop
    // reason, the usage record and the content blocks below are unchanged.
    const response = await this.client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Never disabled. With thinking off the documented failure mode is a tool call written
      // into visible text - the turn succeeds, nothing runs, no error is raised - which under a
      // run-denominated budget is a silently wasted iteration.
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      system,
      messages: [{ role: "user", content }],
    }).finalMessage();

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (response.stop_reason === "refusal") {
      throw new ModelError(
        `the model declined this request (${response.stop_details?.category ?? "no category"})`
      );
    }

    return { text, usage: toUsage(response.usage), stopReason: response.stop_reason ?? "end_turn" };
  }

  /** Free, and it repairs every cost figure at once. There is no reason not to run it first. */
  async countTokens(request: AuthorIrRequest): Promise<number> {
    const content: ContentParam = [
      toBlock(request.prompt.contract),
      ...request.prompt.tail.map(toBlock),
    ];
    const result = await this.client.messages.countTokens({
      model: MODEL,
      system: request.prompt.system.map(toBlock),
      messages: [{ role: "user", content }],
    });
    return result.input_tokens;
  }
}

/**
 * `input_tokens` is the uncached remainder only. Summing the three input fields is what makes
 * the record honest - logging the first alone under-reports by the whole prefix.
 */
export function toUsage(usage: Anthropic.Usage): UsageRecord {
  const creation = usage.cache_creation as
    | { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
    | null
    | undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    ...(creation?.ephemeral_5m_input_tokens !== undefined
      ? { cacheCreation5m: creation.ephemeral_5m_input_tokens }
      : {}),
    ...(creation?.ephemeral_1h_input_tokens !== undefined
      ? { cacheCreation1h: creation.ephemeral_1h_input_tokens }
      : {}),
    priceTableVersion: PRICE_TABLE_VERSION,
    model: MODEL,
  };
}
