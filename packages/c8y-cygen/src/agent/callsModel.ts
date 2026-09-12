/**
 * The second metered boundary: calls the model.
 *
 * Behind an interface, like the Cypress run, and with exactly one production implementation.
 * This is the only structural concession to testability the design makes, and it is what lets
 * the whole loop be driven end to end with no tenant and no API key.
 */
import type { AssembledPrompt } from "./promptAssembly.js";
import type { UsageRecord } from "../pricing/modelPricing.js";

export interface AuthorIrRequest {
  prompt: AssembledPrompt;
  /** Attached to the variable tail, never to the prefix - adding one must not cost the prefix. */
  screenshotPath?: string;
}

export interface AuthorIrResult {
  /** Whatever the model said. Parsing and linting happen outside this boundary. */
  text: string;
  usage: UsageRecord;
  stopReason: string;
}

export interface CallsModel {
  authorIr(request: AuthorIrRequest): Promise<AuthorIrResult>;
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelError";
  }
}

/** The IR arrives as one fenced JSON block. Anything else is a spent turn, reported as one. */
export function parseIrReply(text: string): unknown {
  const fenced = /```(?:json|yaml|yml)?\s*\n([\s\S]*?)```/g;
    const blocks = [...text.matchAll(fenced)].map((m) => (m[1] ?? "").trim());
  if (blocks.length === 0) {
    throw new ModelError(
      "the reply carried no fenced code block, so it holds no IR document"
    );
  }
  if (blocks.length > 1) {
    throw new ModelError(
      `the reply carried ${blocks.length} fenced blocks; exactly one is expected, holding the whole IR`
    );
  }
  try {
    return JSON.parse(blocks[0] as string);
  } catch (e) {
    throw new ModelError(`the fenced block is not valid JSON - ${(e as Error).message}`);
  }
}

/**
 * The model asking for a human instead of authoring an IR. Ticket 11 Q11(c).
 *
 * It arrives inside the same single fenced block an IR does, so the one-block rule does not
 * fork into two reply shapes and a malformed assist is a spent turn like any other malformed
 * reply.
 *
 * It carries only the question. The tool names the trip condition, because a model choosing its
 * own stop condition is a model grading its own work - and two of the seven send a human off to
 * edit a named file, which is not a trip a reply should be able to declare.
 */
export interface AssistRequest {
  /** What a human has to decide. Without it there is no question, so there is no request. */
  why: string;
}

export function assistRequestIn(doc: unknown): AssistRequest | null {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const assist = (doc as { assist?: unknown }).assist;
  if (typeof assist !== "object" || assist === null || Array.isArray(assist)) return null;
  const { why } = assist as { why?: unknown };
  if (typeof why !== "string" || why.trim() === "") return null;
  return { why: why.trim() };
}
