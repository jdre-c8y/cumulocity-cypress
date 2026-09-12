/**
 * The heal drill: B0 against the live tenant with one fault injected, so ticket 11's ladder
 * runs end to end on real infrastructure rather than only against a scripted Cypress.
 *
 * Why a drill and not a wait. The heal path only runs when a spec run fails, and B0 has not
 * failed for a selector reason since the probe learned to report a missed scope. Waiting for a
 * natural failure is waiting for a regression. So the failure is manufactured - but only the
 * failure. Everything downstream of it is the real thing: a real Cypress run goes red against a
 * real tenant, a real diagnostic and screenshot come back, the real source map attributes the
 * line to a step, and the real model gets the real rung-1 block and has to fix it.
 *
 * Where the fault goes matters. It is injected into the model's *reply*, before the loop parses
 * it, so the IR the loop stores and the spec it compiles agree with each other. Injecting later -
 * at the compiler, say - would show the model an IR whose selector is right beside a diagnostic
 * saying that selector failed, and no patch could honestly follow from that.
 *
 * The fault: point the type assertion at the time element. Both rows are real, both were
 * observed by the same probe, and a timestamp does not contain `c8y_LocationUpdate`. So the
 * element is found and the assertion fails - which is the failure rung 1 exists for, and whose
 * fix is exactly what rung 1 permits: re-point at another row the probe already saw.
 *
 * Not committed as part of the tool. Run it, read the attempt log, delete it.
 */
import path from "node:path";
import { AnthropicModel } from "../src/agent/anthropicModel.js";
import { ModuleApiCypressRunner } from "../src/cypress/cypressDriver.js";
import { formatReport, runScenario } from "../src/run/runScenario.js";
import {
  parseIrReply,
  type AuthorIrRequest,
  type AuthorIrResult,
  type CallsModel,
} from "../src/agent/callsModel.js";
import {
  allSteps,
  isProvisional,
  targetOf,
  type IrDocument,
  type IrStep,
  type ResolvedTarget,
} from "../src/ir/types.js";

const REPO = "../../../cumulocity-ui-e2e";
const CONTRACT = "cypress/e2e/dataAndControlTeam/events-generated.scenario.md";
const CONVENTIONS = "conventions/cumulocity-ui.conventions.yaml";

function isSpecMode(ir: IrDocument): boolean {
  for (const step of allSteps(ir)) {
    if (step.collect) return false;
    const target = targetOf(step);
    if (target && isProvisional(target)) return false;
  }
  return true;
}

function setTarget(step: IrStep, target: ResolvedTarget): void {
  if (step.click) step.click.target = target;
  else if (step.settle) step.settle.target = target;
  else if (step.assert) step.assert.target = target;
}

/** Returns a human-readable note about what it broke, or null if the IR has no such pair. */
function misPointTypeAtTime(ir: IrDocument): string | null {
  const steps = allSteps(ir);
  const victim = steps.find(
    (s) => s.assert?.compare === "includes" && typeof s.assert.operand === "string"
  );
  const donor = steps.find((s) => s.assert?.compare === "withinMinutesOfNow");
  if (!victim?.assert || !donor?.assert) return null;

  const was = victim.assert.target;
  const now = donor.assert.target;
  if (isProvisional(was) || isProvisional(now)) return null;
  if (was.resolved === now.resolved) return null;

  setTarget(victim, { ...now });
  return (
    `${victim.id} (asserts text includes "${String(victim.assert.operand)}")\n` +
    `  was  ${was.resolved}   from row ${was.fromRow}\n` +
    `  now  ${now.resolved}   from row ${now.fromRow}   <- borrowed from ${donor.id}`
  );
}

/**
 * Wraps the real model. Corrupts exactly one reply: the first that carries a spec-mode IR.
 * Every later turn - the heal turn above all - is the model's own words, untouched.
 */
class MisPointsOnce implements CallsModel {
  private injected = false;
  constructor(private readonly inner: CallsModel) {}

  async authorIr(request: AuthorIrRequest): Promise<AuthorIrResult> {
    const reply = await this.inner.authorIr(request);
    if (this.injected) return reply;

    let ir: IrDocument;
    try {
      ir = parseIrReply(reply.text) as IrDocument;
    } catch {
      return reply;
    }
    if (!ir?.steps || !isSpecMode(ir)) return reply;

    const note = misPointTypeAtTime(ir);
    if (!note) {
      process.stdout.write("DRILL: the first spec IR had no type/time assert pair to swap.\n");
      return reply;
    }
    this.injected = true;
    process.stdout.write(`\nDRILL: fault injected into the first spec IR.\n  ${note}\n\n`);
    return { ...reply, text: "```json\n" + JSON.stringify(ir, null, 2) + "\n```" };
  }
}

async function main(): Promise<void> {
  const runId = process.argv[2] ?? "b0-heal-drill";
  const report = await runScenario({
    targetRepo: REPO,
    contractPath: CONTRACT,
    conventionsPath: CONVENTIONS,
    runId,
    runsCypress: new ModuleApiCypressRunner(),
    callsModel: new MisPointsOnce(new AnthropicModel()),
    styleOverride: "integration",
    baseUrl: process.env["C8Y_BASE_URL"] as string,
    log: (line) => process.stdout.write(`${line}\n`),
  });

  process.stdout.write(`\n${formatReport(report)}\n`);
  process.stdout.write(
    `\nattempt log: ${path.join(REPO, ".cygen/runs", report.runId, "attempts.jsonl")}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  process.exitCode = 1;
});
