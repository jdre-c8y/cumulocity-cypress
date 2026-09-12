import { ModelError, assistRequestIn, parseIrReply } from "./callsModel.js";
import { assemblePrompt, conventionsForModel, type PromptInput } from "./promptAssembly.js";
import { b0Contract, b0Conventions, b0Facts, b0Ir } from "../testing/b0.js";

function input(over: Partial<PromptInput> = {}): PromptInput {
  return {
    contract: b0Contract(),
    conventions: b0Conventions(),
    houseRules: "# House rules\n\nAlways use data-cy.\n",
    ir: null,
    facts: null,
    lint: null,
    attempts: [],
    progressLine: "run 0 of 6 (probe 0 of 3, model turn 0 of 12), 0 of 7 Expected Outcomes covered",
    effectiveStyle: "integration",
    ...over,
  };
}

describe("the three cache breakpoints", () => {
  it("marks one boundary per stability tier, longest-lived first", () => {
    // Entries with the longer TTL have to appear before shorter ones, which BP1 -> BP2 -> BP3
    // satisfies by construction.
    const p = assemblePrompt(input());

    expect(p.system.filter((b) => b.cache)).toHaveLength(1);
    expect(p.system[p.system.length - 1]?.cache).toEqual({ ttl: "1h" });
    expect(p.contract.cache).toEqual({ ttl: "1h" });
    expect(p.tail[p.tail.length - 1]?.cache).toEqual({ ttl: "5m" });
    expect(p.tail.slice(0, -1).every((b) => !b.cache)).toBe(true);
  });

  it("keeps the progress line out of the system block", () => {
    // It reads like an instruction, which is exactly the trap: in the system block it would
    // invalidate the whole prefix every iteration.
    const p = assemblePrompt(input());
    const systemText = p.system.map((b) => b.text).join("\n");

    expect(systemText).not.toContain("run 0 of 6");
    expect(p.tail.map((b) => b.text).join("\n")).toContain("run 0 of 6");
  });

  it("keeps the prefix hash stable across iterations that only change the tail", () => {
    const first = assemblePrompt(input());
    const later = assemblePrompt(
      input({
        ir: b0Ir(),
        facts: b0Facts(),
        progressLine: "run 2 of 6 (probe 1 of 3, model turn 2 of 12), 7 of 7 Expected Outcomes covered",
      })
    );

    expect(later.prefixHash).toBe(first.prefixHash);
  });

  it("changes the prefix hash when the house rules change underneath it", () => {
    // Cache isolation is per workspace, and a developer with uncommitted edits to that file
    // silently gets their own namespace. The hash is how that becomes visible in the log.
    const edited = assemblePrompt(input({ houseRules: "# House rules\n\nEdited locally.\n" }));

    expect(edited.prefixHash).not.toBe(assemblePrompt(input()).prefixHash);
  });

  it("ships the IR schema as the bytes on disk rather than a rebuilt object", () => {
    const schemaBlock = assemblePrompt(input()).system.at(-1)?.text ?? "";

    expect(schemaBlock).toContain("c8y-cygen/ir.schema.json");
    expect(schemaBlock).toContain("SHAPE ONLY");
  });
});

describe("what the model is shown", () => {
  it("shows the blessed vocabulary and the value builders", () => {
    const shown = conventionsForModel(b0Conventions());

    expect(shown).toContain("createDevice");
    expect(shown).toContain("uniqueName");
    expect(shown).toContain("testDataPrefix: e2e");
  });

  it("keeps the two largest artifacts out of the prompt entirely", () => {
    // Style goes to the compiler and is never shown; the reachability index is looked up by
    // route and never dumped. That matters more than anything else in the payload.
    const shown = conventionsForModel(b0Conventions());

    expect(shown).not.toContain("prettier");
    expect(shown).not.toContain("specRoot");
    expect(shown).not.toContain("describeOptions");
  });

  it("shows a summary of the candidate rows, never the rows themselves", () => {
    const p = assemblePrompt(input({ facts: b0Facts() }));
    const tail = p.tail.map((b) => b.text).join("\n");

    expect(tail).toContain("event-detail#1");
    expect(tail).toContain("data-cy=c8y-event-details--source-wrapper");
    expect(tail).not.toContain("ancestors");
  });

  it("says plainly that nothing can be resolved before a probe has run", () => {
    const tail = assemblePrompt(input()).tail.map((b) => b.text).join("\n");

    expect(tail).toContain("No probe has run");
  });

  it("names the style the run will actually generate in", () => {
    // B0's contract says mocked and the benchmark says integration. Under mocked style the
    // event is served by a stub, so four of the seven outcomes would assert against a fiction -
    // which the anti-gaming rule forbids outright.
    const p = assemblePrompt(
      input({
        effectiveStyle: "integration",
        styleNote: "the contract says mocked; a mocked B0 is unbuildable under the anti-gaming rule",
      })
    );

    expect(p.contract.text).toContain("Generate this in **integration** style.");
    expect(p.contract.text).toContain("unbuildable under the anti-gaming rule");
  });
});

describe("parseIrReply", () => {
  it("takes the one fenced block the model was asked for", () => {
    expect(parseIrReply('Here it is:\n```json\n{"version":1}\n```\n')).toEqual({ version: 1 });
  });

  it("refuses a reply with no fenced block, rather than guessing at one", () => {
    expect(() => parseIrReply("I think the selector is [data-cy=x].")).toThrow(ModelError);
  });

  it("refuses a reply with two fenced blocks", () => {
    expect(() => parseIrReply("```json\n{}\n```\nand\n```json\n{}\n```")).toThrow(/2 fenced/);
  });

  it("reports invalid JSON as a spent turn rather than crashing the run", () => {
    expect(() => parseIrReply("```json\n{version: 1,}\n```")).toThrow(/not valid JSON/);
  });
});

describe("an assist request in place of an IR", () => {
  // Ticket 11 Q11(c): the model may ask for a human instead of authoring. It arrives in the
  // same single fenced block an IR does, so the one-block rule does not fork into two shapes.
  const ask = (body: string): unknown => parseIrReply("```json\n" + body + "\n```");

  it("is recognised, and carries the reason the human has to read", () => {
    expect(assistRequestIn(ask('{"assist":{"why":"the page shows 1 row, the scenario says 3"}}')))
      .toEqual({ why: "the page shows 1 row, the scenario says 3" });
  });

  it("carries only the question: the tool names the trip condition, not the model", () => {
    // Two of the seven conditions send a human off to edit a named file. A reply must not be
    // able to declare one, and `budget-exhausted` must not be claimable while budget remains.
    expect(
      assistRequestIn(ask('{"assist":{"condition":"budget-exhausted","why":"the tab never renders"}}'))
    ).toEqual({ why: "the tab never renders" });
  });

  it("is not an IR, and an IR is not one of these", () => {
    expect(assistRequestIn(ask('{"version":1,"steps":[]}'))).toBeNull();
  });

  it("needs a reason, because the whole point is the question a human answers", () => {
    expect(assistRequestIn(ask('{"assist":{"condition":"app-contradicts-scenario"}}'))).toBeNull();
    expect(assistRequestIn(ask('{"assist":{"why":"   "}}'))).toBeNull();
  });

  it("is not tripped by anything else that happens to parse", () => {
    for (const doc of [null, 42, "assist", [], { assist: null }, { assist: "please" }]) {
      expect(assistRequestIn(doc)).toBeNull();
    }
  });
});

describe("the heal turn's instructions", () => {
  const tailOf = (over: Partial<PromptInput>): string =>
    assemblePrompt(input(over)).tail.map((b) => b.text).join("\n\n");

  it("says nothing at all when the run is not healing", () => {
    expect(tailOf({})).not.toMatch(/heal|rung/i);
  });

  it("names the step the failure mapped to, so the model is not re-reading a stack trace", () => {
    const text = tailOf({ heal: { rung: "patch", failingStepPath: "steps[7]" } });

    expect(text).toContain("steps[7]");
  });

  it("on rung 1, offers the re-point and forbids authoring a selector", () => {
    const text = tailOf({ heal: { rung: "patch", failingStepPath: "steps[7]" } });

    expect(text).toMatch(/re-point/i);
    expect(text).toMatch(/never author a selector|do not write a selector/i);
  });

  it("on rung 1, offers the escape hatch when no observed row fits", () => {
    // Ticket 11 Q10(b): skip the patch and re-probe at once rather than burning a spec run
    // guessing. B2's render branch means the first probe may never have seen the row at all.
    const text = tailOf({ heal: { rung: "patch" } });

    expect(text).toMatch(/provisional/);
  });

  it("on rung 2, asks for the demotion and for collect points at the failure", () => {
    const text = tailOf({ heal: { rung: "re-probe", failingStepPath: "steps[7]" } });

    expect(text).toMatch(/provisional/);
    expect(text).toMatch(/collect/i);
  });

  it("re-prompts a rejected diff with the reason it was rejected", () => {
    const text = tailOf({
      heal: { rung: "patch", rejectedReason: "steps[7].assert.operand is a frozen field" },
    });

    expect(text).toContain("steps[7].assert.operand is a frozen field");
    // One re-prompt, then assist. The model should know the next one is not free.
    expect(text).toMatch(/last attempt|only one/i);
  });

  it("offers the assist reply, so a contradiction does not become a guess", () => {
    const text = tailOf({ heal: { rung: "patch" } });

    expect(text).toContain('"assist"');
  });
});

