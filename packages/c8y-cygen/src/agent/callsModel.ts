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
