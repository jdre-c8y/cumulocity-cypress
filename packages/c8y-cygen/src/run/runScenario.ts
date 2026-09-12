/**
 * The loop. One artifact, one kind of model turn, a fresh stateless session each iteration.
 *
 *   contract + conventions
 *     -> [author or refine the IR]   the only model stage
 *     -> [compile: probe or spec]    deterministic, no model
 *     -> [run Cypress]               no model; the only metered operation
 *     -> facts | pass | diagnostic
 *     -> back to refine
 *
 * There are no phases. "Gather ground truth" is not one: it is an early iteration compiled in
 * probe mode because the IR did not yet lint. The choice of back-end is a property of one turn.
 *
 * There is no state to carry across a boundary, because the IR is the state and it is on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stringify as toYaml } from "yaml";
import { AttemptLog, totals, type AttemptEntry, type RunTotals } from "../attempt/attemptLog.js";
import { Budget, DEFAULT_LIMITS, type BudgetLimits } from "../budget/budget.js";
import { compile } from "../compiler/compile.js";
import { buildSourceMap, stepAtLine, type SourceMap } from "../compiler/sourceMap.js";
import { parseScenarioContract } from "../contract/scenarioContract.js";
import { resolveForSpecPath, loadConventions } from "../conventions/loadConventions.js";
import type { Conventions, EffectiveConventions } from "../conventions/types.js";
import type { CypressRunResult, RunsCypress } from "../cypress/cypressDriver.js";
import { lintIr, type LintResult, type TripCondition } from "../ir/lintIr.js";
import { checkPatch, diffIr, type PatchHistoryEntry } from "../ir/patchDiff.js";
import { allSteps, isProvisional, targetOf, type IrDocument } from "../ir/types.js";
import { readFacts } from "../probe/readFacts.js";
import type { FactsDocument } from "../facts/types.js";
import { score, formatScore, type Score } from "../scorer/scorer.js";
import { assemblePrompt, readHouseRules, type HealTurn } from "../agent/promptAssembly.js";
import {
  assistRequestIn,
  parseIrReply,
  ModelError,
  type CallsModel,
} from "../agent/callsModel.js";
import { resolvesToSameSelector, rungFor, selectorAt } from "./healLadder.js";
import { readPackageAsset } from "../support/assets.js";
import { WorkingArea, discardSpec, specPathForContract } from "../workarea/workingArea.js";
import {
  formatStrays,
  snapshotRepoTree,
  straysBetween,
  type StrayReport,
} from "../workarea/strayFiles.js";
import { mayWrite, withHeader } from "../workarea/provenance.js";

export const TOOL_VERSION = "0.2.0";

/**
 * The two conditions that cannot be iterated out of. Both are answered by a human committing to
 * one of two files, which the next run reads like any other input.
 */
const TERMINAL_TRIPS = new Set<TripCondition>(["zero-dom-steps", "vocabulary-gap"]);

export interface RunOptions {
  targetRepo: string;
  /** Repo-relative path of the scenario contract. */
  contractPath: string;
  conventionsPath: string;
  runId: string;
  runsCypress: RunsCypress;
  callsModel: CallsModel;
  limits?: BudgetLimits;
  /** The benchmark's oracle table and preconditions override a stale Style line. */
  styleOverride?: "integration" | "mocked";
  styleNote?: string;
  baseUrl?: string;
  env?: Record<string, string>;
  log?: (line: string) => void;
}

export type StopCondition =
  | TripCondition
  | "green"
  | "no-spec-produced"
  /** The output path is not ours to write: a human wrote or edited the file there. */
  | "spec-path-not-ours"
  /** The ladder has a patch and a re-probe. A third spec failure has nowhere left to go. */
  | "heal-exhausted"
  /** Ticket 11 Q11(c): one rejected diff is re-prompted, a second stops the run. */
  | "heal-rejected-twice";

export interface RunReport {
  runId: string;
  contractPath: string;
  specPath: string;
  score: Score | null;
  stopCondition: StopCondition;
  attempts: AttemptEntry[];
  cost: RunTotals;
  tripwireFired: boolean;
  /**
   * Everything the run needs to say that is not a score: the tripwire, the run gaps, the
   * strays. The score carries these too, but a run that produces no spec has no score - and
   * that is exactly the run whose notes are worth reading.
   */
  notes: string[];
  /**
   * Files that appeared in the target repo's tree while the run was happening and are not the
   * spec or the working area. Ticket 09 §5: setup writes to the repo, runs do not.
   */
  strays: StrayReport;
}

function modeFor(ir: IrDocument): "probe" | "spec" {
  for (const step of allSteps(ir)) {
    if (step.collect) return "probe";
    const target = targetOf(step);
    if (target && isProvisional(target)) return "probe";
  }
  return "spec";
}

function runFormatter(conventions: Conventions, repo: string, file: string): boolean {
  const [command, ...rest] = conventions.formatter.run;
  if (!command) return false;
  const cwd = path.resolve(repo, conventions.formatter.cwd ?? ".");
  const bin = path.isAbsolute(command) ? command : path.join(cwd, command);
  if (!fs.existsSync(bin)) return false;
  try {
    execFileSync(
      bin,
      rest.map((a) => a.replace("{file}", file)),
      { cwd, stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The spec is written at its final path from the first iteration, formatted by the repo's own
 * formatter, and only then given its provenance header - so the hash covers exactly the bytes a
 * later run will compare against.
 */
function writeFormattedSpec(
  absoluteSpecPath: string,
  body: string,
  conventions: Conventions,
  repo: string,
  contractPath: string,
  notGreen: boolean
): { written: boolean; content: string; formatted: boolean; reason?: string } {
  const existing = fs.existsSync(absoluteSpecPath)
    ? fs.readFileSync(absoluteSpecPath, "utf8")
    : null;
  const verdict = mayWrite(existing);
  if (!verdict.allowed) {
    return { written: false, content: "", formatted: false, reason: verdict.detail };
  }

  // Format the body alone and attach the header afterwards, so the hash covers exactly the bytes
  // the formatter produced. Between these two writes the file carries no header, so a process
  // killed here leaves a file the next run refuses to overwrite - which errs toward keeping
  // whatever is on disk rather than destroying it.
  fs.mkdirSync(path.dirname(absoluteSpecPath), { recursive: true });
  fs.writeFileSync(absoluteSpecPath, body);
  const formatted = runFormatter(conventions, repo, absoluteSpecPath);
  const formattedBody = fs.readFileSync(absoluteSpecPath, "utf8");
  fs.writeFileSync(
    absoluteSpecPath,
    withHeader({ toolVersion: TOOL_VERSION, contractPath, notGreen }, formattedBody)
  );

  return {
    written: true,
    content: fs.readFileSync(absoluteSpecPath, "utf8"),
    formatted,
  };
}

export async function runScenario(options: RunOptions): Promise<RunReport> {
  const log = options.log ?? (() => {});
  const repo = path.resolve(options.targetRepo);
  const area = new WorkingArea(repo, options.runId);
  const budget = new Budget(options.limits ?? DEFAULT_LIMITS);

  area.acquireLock();
  area.prepare();

  // Taken before the first Cypress run and again after the last cleanup, so what the target
  // repo's own plugins write lands in the difference rather than in the developer's next commit.
  const treeBefore = snapshotRepoTree(repo);
  let specRelative: string | null = null;

  try {
    const contract = parseScenarioContract(
      fs.readFileSync(path.join(repo, options.contractPath), "utf8"),
      options.contractPath
    );
    specRelative = specPathForContract(options.contractPath);
    const specAbsolute = path.join(repo, specRelative);
    const baseConventions = loadConventions(options.conventionsPath);
    const conventions: EffectiveConventions = resolveForSpecPath(baseConventions, specRelative);

    if (!conventions.generate) {
      throw new Error(
        `${specRelative} is in a directory the conventions file marks as out of scope for generation (${conventions.appliedOverrides.join(", ")}).`
      );
    }

    const attemptLog = new AttemptLog(area.attemptLogPath);
    const houseRules = readHouseRules(repo);
    const effectiveStyle = options.styleOverride ?? contract.style ?? "integration";

    let previousIr: IrDocument | null = null;
    let facts: FactsDocument | null = null;
    let lint: LintResult | null = null;
    let lastDiagnostic: string | undefined;
    let lastScreenshot: string | undefined;
    let lastSourceMap: SourceMap | undefined;
    let lastRunResult: CypressRunResult | null = null;
    let specContent = "";
    // Whether THIS run wrote the spec file. Not the same as "a file is at that path".
    let wroteSpec = false;
    let specRuns = 0;
    let green = false;
    let stop: StopCondition = "no-spec-produced";
    // The frozen/free split governs a PATCH - one bounded refine turn after a failed spec run.
    // It must not govern the probe-to-spec transition, where deleting the collect steps and
    // re-pointing every outcome at a real assertion is the whole point of the iteration.
    let previousSpecFailed = false;
    // The heal ladder's state. The failure counter is per spec run, never per step: Cypress
    // stops an it() at its first failure, so one run yields at most one diagnostic.
    let specFailures = 0;
    let rejectionsSinceFailure = 0;
    let failedSelector: string | null = null;
    let failingStepId: string | null = null;
    let failingStepPath: string | null = null;
    // Whether a probe has run since the last spec failure. Q15(b) is a statement about what a
    // re-probe observed, so without this the rule fires on runs where no re-probe happened and
    // the intervention tells a human something that did not occur.
    let probedSinceFailure = false;
    let heal: HealTurn | undefined;
    const interventions: string[] = [];
    const notes: string[] = [];
    const history: PatchHistoryEntry[] = [];

    for (let iteration = 1; ; iteration++) {
      const turnStop = budget.mayCallModel();
      if (turnStop) {
        stop = "budget-exhausted";
        notes.push(`stopped on ${turnStop}: the loop spent its model turns without a green spec`);
        break;
      }

      const covered = lint?.coveredOutcomes.length ?? 0;
      const prompt = assemblePrompt({
        contract,
        conventions,
        houseRules,
        ir: previousIr,
        facts,
        lint,
        attempts: attemptLog.all(),
        ...(lastDiagnostic ? { lastDiagnostic } : {}),
        progressLine: budget.progressLine(covered, contract.outcomes.length),
        effectiveStyle,
        ...(heal ? { heal } : {}),
        ...(options.styleNote ? { styleNote: options.styleNote } : {}),
      });

      const startedAt = new Date().toISOString();
      budget.countModelTurn();
      const reply = await options.callsModel.authorIr({
        prompt,
        ...(lastScreenshot ? { screenshotPath: lastScreenshot } : {}),
      });

      const base: Omit<AttemptEntry, "ir" | "changed" | "verdict" | "run" | "mode"> = {
        iteration,
        startedAt,
        usage: reply.usage,
        prefixHash: prompt.prefixHash,
        modelTurns: 1,
      };

      let parsed: unknown;
      try {
        parsed = parseIrReply(reply.text);
      } catch (e) {
        if (!(e instanceof ModelError)) throw e;
        attemptLog.append({
          ...base,
          mode: previousIr ? modeFor(previousIr) : "probe",
          ir: previousIr ?? ({} as IrDocument),
          changed: [],
          verdict: "rejected",
          rejectReason: e.message,
          run: "none",
        });
        log(`iteration ${iteration}: ${e.message}`);
        continue;
      }

      // Ticket 11 Q12(a): the model may ask for a human instead of authoring, which fires the
      // seventh trip condition with no wasted turn. The tool names the condition - a model
      // naming its own stop condition is a model grading its own work.
      const asked = assistRequestIn(parsed);
      if (asked) {
        // One condition, named here rather than read off the reply. `budget-exhausted` and
        // `zero-dom-steps` send a human to do specific things; a model that picks its own
        // stop condition is a model grading its own work.
        const condition: TripCondition = "app-contradicts-scenario";
        attemptLog.append({
          ...base,
          mode: previousIr ? modeFor(previousIr) : "probe",
          ir: previousIr ?? ({} as IrDocument),
          changed: [],
          verdict: "accepted",
          run: "none",
          stopCondition: condition,
        });
        stop = condition;
        interventions.push(`${condition}: ${asked.why}`);
        log(`iteration ${iteration}: the model asked for a human - ${asked.why}`);
        break;
      }

      const ir = parsed as IrDocument;
      const changed = previousIr ? diffIr(previousIr, ir) : [];
      if (previousIr && previousSpecFailed) {
        // After a re-probe, a value coming back is not the model flip-flopping. The ladder
        // re-derived it from fresh observation, so landing on the selector that failed is the
        // finding rather than the mistake - and Q15(b) below is what answers it, by stopping
        // the run and handing a human the strongest question any iteration could produce.
        // Feeding the history here instead rejects the correct result of rung 2 every time.
        const patch = checkPatch(previousIr, ir, probedSinceFailure ? [] : history);
        if (!patch.accepted) {
          attemptLog.append({
            ...base,
            mode: modeFor(ir),
            ir,
            changed,
            verdict: "rejected",
            ...(patch.reason ? { rejectReason: patch.reason } : {}),
            run: "none",
          });
          log(`iteration ${iteration}: diff rejected - ${patch.reason}`);
          // A rejection costs a model turn and never a Cypress run, which is the resource the
          // budget meters - so nothing else stops a model retrying a frozen edit until the
          // turn cap catches it. One re-prompt carries the reason; a second asks a human.
          rejectionsSinceFailure += 1;
          if (rejectionsSinceFailure > 1) {
            stop = "heal-rejected-twice";
            interventions.push(
              `the same failure produced two rejected diffs: ${patch.reason ?? "no reason given"}`
            );
            break;
          }
          if (heal) {
            heal = { ...heal, ...(patch.reason ? { rejectedReason: patch.reason } : {}) };
          }
          continue;
        }
      }

      const mode = modeFor(ir);
      lint = lintIr({
        ir,
        mode,
        conventions,
        contract,
        ...(facts ? { facts } : {}),
      });
      fs.writeFileSync(area.irPath, toYaml(ir));

      const terminal = lint.errors.find((e) => e.trip && TERMINAL_TRIPS.has(e.trip));
      if (terminal?.trip) {
        attemptLog.append({
          ...base,
          mode,
          ir,
          changed,
          verdict: "accepted",
          run: "none",
          lintErrors: lint.errors.map((e) => `${e.where}: ${e.message}`),
          stopCondition: terminal.trip,
        });
        stop = terminal.trip;
        interventions.push(`${terminal.trip}: ${terminal.message}`);
        log(`iteration ${iteration}: stopped on ${terminal.trip} - ${terminal.message}`);
        previousIr = ir;
        break;
      }

      if (!lint.ok) {
        attemptLog.append({
          ...base,
          mode,
          ir,
          changed,
          verdict: "accepted",
          run: "none",
          lintErrors: lint.errors.map((e) => `${e.where}: ${e.message}`),
        });
        previousIr = ir;
        log(`iteration ${iteration}: ${lint.errors.length} lint error(s), no run spent`);
        continue;
      }

      // Ticket 11 Q15(b). The re-probe has just re-observed the element and the ladder landed
      // back on the selector that failed, so the failure was never a selector problem and
      // re-running would fail identically with most of the budget gone. The question this
      // hands a human is the strongest one any earlier run could have produced: the selector
      // is right, the probe just confirmed it, and the assertion still fails.
      if (
        mode === "spec" &&
        specFailures >= 2 &&
        probedSinceFailure &&
        resolvesToSameSelector(ir, failingStepId, failedSelector)
      ) {
        attemptLog.append({
          ...base,
          mode,
          ir,
          changed,
          verdict: "accepted",
          run: "none",
          stopCondition: "app-contradicts-scenario",
        });
        stop = "app-contradicts-scenario";
        interventions.push(
          `app-contradicts-scenario: the re-probe resolved ${failingStepPath} back to ` +
            `${failedSelector}, the selector that just failed. The element is there and the ` +
            `selector is right, so the scenario and the application disagree about something else.`
        );
        previousIr = ir;
        log(`iteration ${iteration}: the re-probe confirmed the selector that failed; no run spent`);
        break;
      }

      const runStop = budget.mayRun(mode);
      if (runStop) {
        attemptLog.append({
          ...base,
          mode,
          ir,
          changed,
          verdict: "accepted",
          run: "none",
          stopCondition: "budget-exhausted",
        });
        stop = "budget-exhausted";
        notes.push(`stopped on ${runStop}`);
        previousIr = ir;
        break;
      }

      // `facts` is not optional in practice once an IR carries a stub: the compiler reads the
      // stubbed response body out of the facts document, because the model names an observed
      // exchange and never writes a body. Passing it unconditionally keeps that one code path.
      const compiled = compile({
        ir,
        mode,
        conventions,
        itTags: contract.tags,
        ...(facts ? { facts } : {}),
      });

      // `previousSpecFailed` is NOT cleared here. It used to be, for every compile including a
      // probe one - so a rung-2 re-probe switched the frozen/free split off for the turn after
      // it, which is the turn that writes the spec, on the rung reached only after two failures.
      // The guard stays on until a spec run is green, and green leaves the loop.
      //
      // The rung, though, is spent. Carrying it into the next turn tells a model that has just
      // re-probed to re-probe again, which loops until the probe cap ends the run - and
      // carries a stale "this is your last attempt" with it.
      heal = undefined;

      if (mode === "probe") {
        // The probe runtime is copied in and imported relatively. It is never installed in the
        // target repo and never committed - only facts survive the run that made it.
        fs.writeFileSync(
          path.join(area.probeDir, "runtime.js"),
          readPackageAsset("probe/runtime.js")
        );
        const probeSpec = area.writeProbeSpec(
          `iteration-${iteration}`,
          `import './runtime';\n\n${compiled.text}`
        );
        budget.countRun("probe");
        const result = await options.runsCypress.run({
          targetRepo: repo,
          specPath: probeSpec,
          screenshotsFolder: area.screenshotsFolder,
          videosFolder: area.videosFolder,
          downloadsFolder: area.downloadsFolder,
          specPattern: area.probeSpecPattern(),
          env: { ...options.env, c8yCygenFactsDir: area.factsDirFor(iteration) },
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        });
        // A probe that dies partway still returns everything it already collected. That is
        // normal, and it is why a wrong provisional guess costs progress rather than the run.
        facts = readFacts(area.factsDir, {
          runId: options.runId,
          tenantUrl: options.baseUrl ?? "",
          complete: result.pass,
        });
        attemptLog.append({
          ...base,
          mode,
          ir,
          changed,
          verdict: "accepted",
          run: "probe",
          runPassed: result.pass,
          runStartedAt: result.startedAt,
          runDurationMs: result.durationMs,
          ...(result.testFailures[0]?.errorMessage
            ? { diagnostic: result.testFailures[0].errorMessage }
            : {}),
        });
        // A probe run is deliberately NOT patch history. The oscillation check reads history as
        // "this value was tried and the run that followed failed", and a probe that dies partway
        // is normal rather than exceptional - it is how a wrong provisional guess reports itself.
        // Counting it indexes every field that iteration touched as already-failed, so the very
        // re-point the probe just confirmed comes back rejected, and two of those end the run at
        // heal-rejected-twice over nothing.
        previousIr = ir;
        probedSinceFailure = true;
        log(
          `iteration ${iteration}: probe run, ${facts.surfaces.length} surface(s), ${facts.surfaces.reduce((n, s) => n + s.rows.length, 0)} row(s)`
        );
        continue;
      }

      const write = writeFormattedSpec(
        specAbsolute,
        compiled.text,
        baseConventions,
        repo,
        options.contractPath,
        true
      );
      if (!write.written) {
        stop = "spec-path-not-ours";
        interventions.push(
          `refused to write ${specRelative}: ${write.reason ?? "the path is not ours to write"}`
        );
        previousIr = ir;
        break;
      }
      wroteSpec = true;
      specContent = write.content;
      if (!write.formatted) {
        notes.push(
          "the repo's formatter did not run, so quoting and layout are the compiler's rather than the repo's"
        );
      }
      lastSourceMap = buildSourceMap(specRelative, specContent, compiled.statements);
      fs.writeFileSync(area.sourceMapPath, JSON.stringify(lastSourceMap, null, 2));

      budget.countRun("spec");
      specRuns += 1;
      const result = await options.runsCypress.run({
        targetRepo: repo,
        specPath: specAbsolute,
        screenshotsFolder: area.screenshotsFolder,
        videosFolder: area.videosFolder,
        downloadsFolder: area.downloadsFolder,
        ...(options.env ? { env: options.env } : {}),
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      });
      lastRunResult = result;

      const failure = result.testFailures[0];
      const failingLine = failure?.location?.line;
      // The path is what a human reads; the id is what survives an insertion, and both rungs
      // invite the model to insert a step.
      const failingEntry =
        failingLine !== undefined && lastSourceMap
          ? stepAtLine(lastSourceMap, failingLine)
          : undefined;
      const failingStep = failingEntry?.stepPath;
      lastDiagnostic = failure?.errorMessage ?? result.specFailures[0]?.errorMessage;
      lastScreenshot = failure?.screenshotPath;

      attemptLog.append({
        ...base,
        mode,
        ir,
        changed,
        verdict: "accepted",
        run: "spec",
        runPassed: result.pass,
        runStartedAt: result.startedAt,
        runDurationMs: result.durationMs,
        ...(failingStep ? { failingStepPath: failingStep } : {}),
        ...(lastDiagnostic ? { diagnostic: lastDiagnostic } : {}),
        ...(lastScreenshot ? { screenshotPath: lastScreenshot } : {}),
        sourceMap: lastSourceMap,
      });
      history.push({ changed, passed: result.pass });
      previousIr = ir;

      if (result.pass) {
        green = true;
        stop = "green";
        // Re-write the header without the not-green mark now that the run is green. The refusal
        // is honoured here too: if someone touched the file between the run and this write, the
        // NOT-GREEN header survives on a green spec - and reading it back regardless is how that
        // stale content reached the scorer, which is what axis B is computed from.
        const regreened = writeFormattedSpec(
          specAbsolute,
          compiled.text,
          baseConventions,
          repo,
          options.contractPath,
          false
        );
        if (!regreened.written) {
          notes.push(
            `the spec went green but the not-green header could not be cleared: ${regreened.reason ?? "the path is not ours to write"}`
          );
        }
        specContent = fs.readFileSync(specAbsolute, "utf8");
        lastSourceMap = buildSourceMap(specRelative, specContent, compiled.statements);
        fs.writeFileSync(area.sourceMapPath, JSON.stringify(lastSourceMap, null, 2));
        log(`iteration ${iteration}: spec run passed`);
        break;
      }

      previousSpecFailed = true;
      specFailures += 1;
      rejectionsSinceFailure = 0;
      probedSinceFailure = false;
      failingStepPath = failingStep ?? null;
      failingStepId = failingEntry?.stepId ?? null;
      failedSelector = selectorAt(ir, failingStepId);

      const rung = rungFor(specFailures);
      if (!rung) {
        stop = "heal-exhausted";
        notes.push(
          `the spec run failed ${specFailures} times. The ladder has one patch and one ` +
            `re-probe, and both are spent.`
        );
        log(`iteration ${iteration}: spec run failed again; the heal ladder is out of rungs`);
        break;
      }
      heal = {
        rung,
        ...(failingStepPath ? { failingStepPath } : {}),
      };
      log(
        `iteration ${iteration}: spec run failed at ${failingStep ?? "an unmapped line"}` +
          `; heal rung ${rung}`
      );
    }

    // Only facts survive a probe run.
    area.discardProbeSpecs();

    // A run that does not end green deletes its spec. An assist is not that failure: its spec
    // stays, marked not green, so the human can run the thing they are being asked about.
    //
    // Its spec, though - the one this run wrote. A run that never reached spec mode has nothing
    // of its own at that path, and what is there is whatever was committed before it started.
    // Deleting that destroys work nobody asked to lose, on the way to reporting a failure that
    // had nothing to do with it.
    if (wroteSpec && !green && stop !== "green" && interventions.length === 0) {
      discardSpec(specAbsolute);
    }

    const strays = straysBetween(treeBefore, snapshotRepoTree(repo), [specRelative]);
    if (strays.strays.length > 0) {
      notes.push(
        `${strays.strays.length} file(s) outside .cygen/ changed in the target repo while the ` +
          `run ran, and none of them is the spec: ${strays.strays.map((s) => s.path).join(", ")}`
      );
    }

    // Reported because it is a judgement the tool deliberately does not make. The linter counts
    // outcomes asserting a value a stub in the same test wrote and refuses none of them, so the
    // count has to reach the person grading flow equivalence or it may as well not exist.
    if (lint && lint.stubSatisfied.length > 0) {
      const which = [...new Set(lint.stubSatisfied.map((x) => x.outcome))].sort((a, b) => a - b);
      notes.push(
        `outcome(s) ${which.join(", ")} assert a value a stub in this same test wrote ` +
          `(${lint.stubSatisfied.map((x) => `${x.outcome} via ${x.via}`).join("; ")}). ` +
          `Legal under a mocked style and counted rather than refused - read the flow and decide ` +
          `whether each is the scenario's real subject or a value handed straight back.`
      );
    }

    const cost = totals(attemptLog.all());
    if (budget.tripwireFired()) {
      notes.push(
        `TRIPWIRE: ${budget.probeRuns} probe runs against a cap of ${budget.limits.probeRuns}. This reopens the Cypress-probe decision.`
      );
    }
    if (cost.runGapsMs.some((ms) => ms > 5 * 60_000)) {
      notes.push(
        "at least one start-to-start gap between Cypress runs exceeded five minutes, which is the condition the one-hour cache TTL was chosen for"
      );
    }

    const scored =
      specContent && lastSourceMap
        ? score({
            contract,
            specText: specContent,
            specPath: specRelative,
            sourceMap: lastSourceMap,
            runResult: lastRunResult,
            specAttempts: specRuns,
            retriesDisabled: true,
            interventions,
            cost,
            notes,
          })
        : null;

    return {
      runId: options.runId,
      contractPath: options.contractPath,
      specPath: specRelative,
      score: scored,
      stopCondition: stop,
      attempts: attemptLog.all(),
      cost,
      tripwireFired: budget.tripwireFired(),
      notes,
      strays,
    };
  } catch (e) {
    // Ticket 12 guarantees dying partway is normal, so this is the common path, not the rare
    // one - and it is precisely when a plugin's leftovers would otherwise reach a commit
    // unmentioned. There is no RunReport to carry them, so they go out through the log.
    log(formatStrays(straysBetween(treeBefore, snapshotRepoTree(repo), specRelative ? [specRelative] : [])));
    throw e;
  } finally {
    area.releaseLock();
  }
}

export function formatReport(report: RunReport): string {
  const lines = [
    `run ${report.runId}  ${report.contractPath}`,
    `stopped because: ${report.stopCondition}`,
    "",
  ];
  if (report.score) {
    lines.push(formatScore(report.score, report.specPath));
  } else {
    lines.push(
      "No spec was produced, so there is nothing to score on axes A or B.",
      `  cost  $${report.cost.costUsd.toFixed(4)} over ${report.cost.iterations} iteration(s), ` +
        `${report.cost.totalRuns} Cypress run(s), ${report.cost.modelTurns} model turn(s)`
    );
    // Only here. With a score, formatScore prints them, and printing them twice teaches a
    // reader to skip the block.
    for (const note of report.notes) lines.push(`  note  ${note}`);
  }
  lines.push("", formatStrays(report.strays));
  return lines.join("\n");
}

