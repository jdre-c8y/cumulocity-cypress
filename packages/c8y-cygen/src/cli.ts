#!/usr/bin/env node
/**
 * One command takes a scenario contract and a target repo and produces a scored verdict, so a
 * benchmark pass is one action and not a procedure.
 */
import fs from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { AnthropicModel } from "./agent/anthropicModel.js";
import { assemblePrompt, readHouseRules } from "./agent/promptAssembly.js";
import {
  draftConventionsYaml,
  mineConventions,
  mineReachIndex,
  registryProbeSpec,
  type RegistryDump,
} from "./conventions/scout.js";
import { loadConventions, resolveForSpecPath } from "./conventions/loadConventions.js";
import { parseScenarioContract } from "./contract/scenarioContract.js";
import { ModuleApiCypressRunner } from "./cypress/cypressDriver.js";
import { formatReport, runScenario } from "./run/runScenario.js";
import { WorkingArea, ensureIgnored, specPathForContract } from "./workarea/workingArea.js";

function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .scriptName("c8y-cygen")
    .command(
      "init",
      "Add the working area to the target repo's .gitignore. Setup writes to the repo; runs do not.",
      (y) => y.option("repo", { type: "string", demandOption: true }),
      (argv) => {
        const result = ensureIgnored(argv.repo);
        process.stdout.write(`.cygen/ in ${argv.repo}/.gitignore: ${result}\n`);
      }
    )
    .command(
      "scout",
      "Mine a target repo: a draft conventions file to review, and the reachability index cache.",
      (y) =>
        y
          .option("repo", { type: "string", demandOption: true })
          .option("out", { type: "string", describe: "directory to write the two outputs to" })
          .option("registry", {
            type: "string",
            describe: "the registry dump the enumeration probe wrote",
          }),
      (argv) => {
        const out = argv.out ?? path.join(argv.repo, ".cygen");
        fs.mkdirSync(out, { recursive: true });

        const mined = mineConventions(argv.repo);
        const registry: RegistryDump | null = argv.registry
          ? (JSON.parse(fs.readFileSync(argv.registry, "utf8")) as RegistryDump)
          : null;

        const draft = path.join(out, `${mined.repo}.conventions.draft.yaml`);
        fs.writeFileSync(draft, draftConventionsYaml(mined, registry));

        const index = path.join(out, `${mined.repo}.reach.index.json`);
        fs.writeFileSync(index, JSON.stringify(mineReachIndex(argv.repo), null, 2));

        const area = new WorkingArea(argv.repo, "scout");
        area.prepare();
        const probe = area.writeProbeSpec(
          "enumerate-commands",
          registryProbeSpec(path.join(out, "commands.json"))
        );

        process.stdout.write(
          [
            `draft conventions   ${draft}    <- review every line, then commit it`,
            `reachability index  ${index}    <- a cache; not reviewed`,
            `registry probe      ${probe}`,
            "",
            "The command list cannot be grepped: run the registry probe against a tenant, then",
            "re-run scout with --registry pointing at the JSON it wrote.",
            "",
          ].join("\n")
        );
      }
    )
    .command(
      "count-tokens",
      "Count tokens against a real assembled prompt. Free, and it repairs every cost estimate at once.",
      (y) =>
        y
          .option("repo", { type: "string", demandOption: true })
          .option("contract", { type: "string", demandOption: true })
          .option("conventions", { type: "string", demandOption: true }),
      async (argv) => {
        const contract = parseScenarioContract(
          fs.readFileSync(path.join(argv.repo, argv.contract), "utf8"),
          argv.contract
        );
        const specPath = specPathForContract(argv.contract);
        const conventions = resolveForSpecPath(loadConventions(argv.conventions), specPath);
        const prompt = assemblePrompt({
          contract,
          conventions,
          houseRules: readHouseRules(argv.repo),
          ir: null,
          facts: null,
          lint: null,
          attempts: [],
          progressLine: "run 0 of 6",
          effectiveStyle: "integration",
        });

        const bytes =
          prompt.system.reduce((n, b) => n + b.text.length, 0) +
          prompt.contract.text.length +
          prompt.tail.reduce((n, b) => n + b.text.length, 0);
        process.stdout.write(`assembled prompt: ${bytes} bytes\n`);

        const counted = await new AnthropicModel().countTokens({ prompt });
        process.stdout.write(
          `real token count: ${counted}\n` +
            `bytes per token:  ${(bytes / counted).toFixed(2)}  ` +
            `(the four-bytes-per-token conversion behind every payload estimate is ` +
            `${(((4 - bytes / counted) / (bytes / counted)) * 100).toFixed(0)}% off)\n`
        );
      }
    )
    .command(
      "run",
      "Generate a spec from a scenario contract and score it.",
      (y) =>
        y
          .option("repo", { type: "string", demandOption: true })
          .option("contract", { type: "string", demandOption: true })
          .option("conventions", { type: "string", demandOption: true })
          .option("style", { choices: ["integration", "mocked"] as const })
          .option("style-note", { type: "string" })
          .option("base-url", { type: "string" })
          .option("run-id", { type: "string" })
          .option("probe-runs", { type: "number", default: 3 })
          .option("total-runs", { type: "number", default: 6 })
          .option("model-turns", { type: "number", default: 12 }),
      async (argv) => {
        const report = await runScenario({
          targetRepo: argv.repo,
          contractPath: argv.contract,
          conventionsPath: argv.conventions,
          runId: argv["run-id"] ?? newRunId(),
          runsCypress: new ModuleApiCypressRunner(),
          callsModel: new AnthropicModel(),
          limits: {
            probeRuns: argv["probe-runs"],
            totalRuns: argv["total-runs"],
            modelTurns: argv["model-turns"],
          },
          ...(argv.style ? { styleOverride: argv.style } : {}),
          ...(argv["style-note"] ? { styleNote: argv["style-note"] } : {}),
          ...(argv["base-url"] ? { baseUrl: argv["base-url"] } : {}),
          log: (line) => process.stdout.write(`${line}\n`),
        });

        process.stdout.write(`\n${formatReport(report)}\n`);
        // A FAIL is a result, not a crash: the point of a run is the measurement, and the
        // attempt log is what makes a failed run data rather than a wasted afternoon.
        process.stdout.write(
          `\nattempt log: ${path.join(argv.repo, ".cygen/runs", report.runId, "attempts.jsonl")}\n`
        );
      }
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  process.exitCode = 1;
});
