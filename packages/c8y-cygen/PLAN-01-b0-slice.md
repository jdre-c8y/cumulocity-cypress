# Plan 01 — the B0 slice: the thinnest c8y-cygen that can score an oracle

Type: implementation
Status: ready
Labels: ready-for-agent
Blocked by: —
Assignee: jdre

Sources, in order of authority: the sixteen resolved tickets in
`.scratch/c8y-cygen-v2/issues/`, the ubiquitous language in `.scratch/c8y-cygen-v2/CONTEXT.md`,
and the acceptance contract in `.scratch/c8y-cygen-v2/benchmark/README.md`. This plan restates
none of them and contradicts none of them. Where it names a rule, the ticket that argued it is
cited so the reasoning stays reachable.

---

## Problem Statement

Writing Cypress E2E specs for Cumulocity UI applications by hand is slow, and the expensive part
is not typing. It is finding out what the running application actually renders — the real
selectors, the real network traffic, the real order of interactions — none of which can be read
off the source, because rendered output is not source.

An earlier attempt at automating this, v1, produced a working tool that nobody could judge. It
reached green on one cheap scenario and beat a human on one hard one, at \$4.22 and \$2.42 for
two runs that produced no spec at all. Sixteen design tickets have since replaced almost all of
its architecture. Every one of those decisions is argued, and **not one of them has been
measured**, because the acceptance benchmark defined in ticket 01 has never been run against
anything — v1 included, whose reconstructed score of 1 PASS / 1 ASSIST / 3 unattempted comes from
a prose document, not from an observation.

So the design effort has produced a complete architecture whose load-bearing numbers are all
estimates, and it cannot produce another useful decision until a number exists. Eleven named
unvalidated assumptions sit on the map waiting for one. Ticket 15 established, by reading the
real oracle rather than a prototype's copy of it, that **B0 — the mandated regression floor —
does not pass today**.

There is nothing left to decide and nothing yet to measure against.

## Solution

Build the smallest thing that can generate a spec for the **B0 oracle** and score it against the
benchmark, and run it. Not a feature-complete c8y-cygen: the slice that produces the first real
number.

B0 is the right target for three independent reasons. It is the regression floor — the pass bar
requires it to PASS, so a design that cannot reach it fails regardless of everything else. It is
the cheapest oracle to run, at an interaction cost of 1, so running it is never a reason to skip
a benchmark pass. And ticket 15 proved it currently fails, so there is a known gap to close
rather than a hope to confirm.

B0 is also far less thin than its cost rating suggests. Generating it exercises **six of the
design's nine parts**: the loop, the IR and both of its closed vocabularies, both compiler
back-ends, the ladder across two rungs plus the repeating-list rule, the conventions scout, and
the hygiene rules for output location. It needs one capture, one value builder, one anchored
`request`, three comparators and an *at least n* cardinality. What it does not touch — the three
intercept verbs, fragments, render branches, plugin loading — is exactly what the later oracles
are for.

The end state of this plan is a run that prints a verdict — PASS or FAIL on axes A and B, with
its cost recorded — plus an attempt log holding the first per-iteration cost and flake data the
design has ever had. A FAIL is a successful outcome of this plan. An unmeasured design is not.

## User Stories

**The scenario author** — a teammate who owns a regression, knows the component, and does not
know this tool.

1. As a scenario author, I want to describe a test in the six-section scenario contract I already
   have worked examples of, so that I do not have to learn a new document format to ask for a
   spec.
2. As a scenario author, I want my scenario contract to be a committed file beside the spec it
   produces, so that the request and the result stay together and either can be re-derived from
   the other.
3. As a scenario author, I want to write hazard annotations as ordinary prose next to the step
   they concern, so that the warning sits where the person and the model both read it.
4. As a scenario author, I want unknown sections and HTML comments in my contract to pass through
   untouched, so that the authoring interview's questions can ride inside the file without
   breaking the parser.
5. As a scenario author, I want the generated spec to land in the directory I saved my contract
   in, so that the team-by-team organisation of the spec tree is honoured without the tool
   guessing at it.
6. As a scenario author, I want each Expected Outcome to be addressable by its number, so that
   the tool can prove which assertion satisfies which outcome rather than matching prose.
7. As a scenario author, I want a re-run to overwrite exactly one file, so that asking twice never
   leaves me with duplicate specs to reconcile.
8. As a scenario author, I want the tool to refuse rather than overwrite when I have hand-edited a
   generated spec, so that my fix is never silently destroyed.

**The tool operator** — whoever runs the benchmark and reads the number.

9. As a tool operator, I want a single command that takes a scenario contract and a target repo
   and produces a scored verdict, so that a benchmark pass is one action and not a procedure.
10. As a tool operator, I want the verdict reported as PASS or FAIL per axis rather than as a bare
    fraction, so that "green but gamed" and "correct but red" are distinguishable.
11. As a tool operator, I want outcome coverage checked independently of whether Cypress reported
    green, so that a spec cannot pass by asserting nothing.
12. As a tool operator, I want the generated spec run with retries disabled regardless of what the
    target repo's own configuration tolerates, so that "green" means green and not green on the
    third try.
13. As a tool operator, I want every Cypress run counted against a cap of three probe runs and six
    total, so that a stuck run announces itself instead of burning money quietly.
14. As a tool operator, I want model turns counted alongside Cypress runs, so that a loop thrashing
    on lint rejections — which costs dollars and advances no run counter — is visible in the same
    record.
15. As a tool operator, I want per-iteration token counts recorded as four separate fields plus the
    price-table version, so that a rate change cannot silently rewrite the cost history.
16. As a tool operator, I want the run's screenshots and videos written to the run's own directory,
    so that the tool stops writing into the folder the repo's visual-regression baselines are
    compared against.
17. As a tool operator, I want the tool to leave my unrelated Cypress artifacts alone, so that
    running it is not destructive to work I did earlier.
18. As a tool operator, I want one run at a time per repo, enforced by a lock, so that two runs
    cannot collide on the fixed literal entity names the house convention uses.
19. As a tool operator, I want a run that fails to still leave its attempt log, so that a failed
    run is data rather than a wasted afternoon.
20. As a tool operator, I want the tool to say which of the named stop conditions ended a run, so
    that "it stopped" is never the whole diagnosis.

**The reviewer** — whoever reads the pull request the tool's output lands in.

21. As a reviewer, I want the generated artifact to be house-style TypeScript, so that I review the
    same kind of file I already review and not a document in a new language.
22. As a reviewer, I want the emitted spec formatted by the target repo's own formatter, so that
    quoting and escaping match the repo without the tool holding an opinion about either.
23. As a reviewer, I want the emitted spec to carry a small provenance header, so that I can tell a
    generated file from a hand-written one at a glance.
24. As a reviewer, I want the tool to reuse the repo's existing helpers and commands rather than
    reinventing them, so that the spec does not read as foreign to the directory it sits in.
25. As a reviewer, I want the tool never to leave a red spec in a committed state, so that the spec
    tree stays trustworthy even when a run ends badly.

**The generating agent** — the model authoring the IR, whose constraints are the design's safety
argument.

26. As the generating agent, I want to author one artifact in one kind of turn, so that there is no
    phase to be confused about and no state to carry across a boundary.
27. As the generating agent, I want to read the current IR, the facts, the diagnostic and the
    attempt log from disk each iteration, so that a fresh session knows what earlier ones tried.
28. As the generating agent, I want the linter to tell me whether I have gathered enough, so that
    "am I done probing?" is a free local check rather than a judgement I could get wrong.
29. As the generating agent, I want to write a deliberately fragile provisional selector so that
    one probe run can walk a flow I cannot yet name precisely.
30. As the generating agent, I want never to write a committed selector myself, so that a
    hallucinated selector is structurally impossible rather than merely detected.
31. As the generating agent, I want a closed vocabulary of value builders instead of raw
    TypeScript, so that every runtime value is something the linter can reason about.
32. As the generating agent, I want to declare how many elements a step expects, so that a mismatch
    reports "declared 3, observed 1" instead of an error pointing nowhere near its cause.
33. As the generating agent, I want to name a step in a capture rather than a selector, so that
    binding a value cannot smuggle in an element nobody observed.
34. As the generating agent, I want to declare which Expected Outcome each assertion satisfies, so
    that coverage is exact rather than inferred from word overlap.
35. As the generating agent, I want a flat step list, so that I describe the test rather than
    reasoning about JavaScript's async scope.
36. As the generating agent, I want the tool to run Cypress, not me, so that the metered resource
    is not something I can spend.

**The design effort** — what this slice owes the next map.

37. As the next implementation effort, I want the first measurement to be the free one — a real
    token count against a real assembled prompt — so that every cost figure in the design is
    repaired before any of them is quoted as measured.
38. As the next implementation effort, I want a real number for B0 on the benchmark, so that the
    eleven unvalidated assumptions have a baseline to be judged against.
39. As the next implementation effort, I want the per-iteration output-token count observed once,
    so that the least-supported number in the cost arithmetic stops being a guess.
40. As the next implementation effort, I want the start-to-start gap between Cypress runs measured,
    so that the one-hour cache TTL decision rests on a clock rather than on an asymmetry argument.
41. As the next implementation effort, I want the number of probe runs B0 actually needs recorded,
    so that ticket 02's pre-registered tripwire fires on evidence rather than being quietly
    forgotten.
42. As the next implementation effort, I want a broken-file regression corpus that grows with every
    capability, so that validation machinery cannot get weaker without anything failing.
43. As the next implementation effort, I want a CI assertion that a second identical request reads
    from cache, so that a caching regression cannot hide behind requests that still succeed.
44. As the next implementation effort, I want the attempt log kept in full for every run, green
    ones included, so that the design's only source of cost and flake data is not swept away
    before it exists.
45. As the next implementation effort, I want the deterministic half of the pipeline testable with
    no tenant and no API key, so that most of the machinery can be exercised in CI.

## Implementation Decisions

### Scope: what B0 forces, and what it does not

The slice is bounded by one question — *what does generating and scoring B0 require?* Everything
else waits for a later oracle. B0's oracle establishes a device and posts an event through a real
API call, navigates to that device's events page, opens the one timeline item, and asserts seven
outcomes about the event detail panel.

That forces: **two ladder rungs** (a `data-cy` attribute and a custom element tag) plus the
repeating-list position rule; **one capture** (the created device's id, which the oracle wraps
the whole remainder of the test in); **one value builder** (a unique-name generator); **one
anchored `request`**; **two blessed helpers**, both globally registered; **three comparators**
(`equals`, `includes`, `withinMinutesOfNow`); **one extractor** (`text`); and an **at least n**
cardinality.

It does not force the three intercept verbs, fragments, render-branch handling, plugin loading,
or the `import` and `inline` bindings. Those are built when the oracle that needs them is
attempted.

### Packaging

The slice is `packages/c8y-cygen/`, a private package in this repository, consuming
`cumulocity-cypress` through its public API only. It does not modify that library, `c8yctrl` or
`c8ypact`. This is a charting premise and is not reopened. `c8yctrl` is not a dependency at all —
ticket 04 removed it from the design entirely when it declined replay.

The directory already exists on disk holding a leftover `node_modules` and a credentials file
from v1. **Both are already covered by the repository's root ignore rules** — this corrects
ticket 16's hygiene warning, which states that adding the directory wholesale would commit a
secret. It would not. The stale contents should still be cleared before the first tracked file
lands, on tidiness grounds rather than safety.

### The pipeline is one loop with one kind of model turn

There are no phases. The model's only stage is *author or refine the IR*. Compilation is
deterministic and has no model in it. The Cypress run has no model in it. "Gather ground truth"
is not a phase — it is an early iteration compiled in probe mode because the IR did not yet lint.

The stop condition is the linter, not a judgement: ticket 02's invariant means an under-probed
IR cannot lint, so *am I done gathering?* is a free local check.

Sessions are **stateless and fresh**. Each iteration reads the scenario contract, the conventions
file, the current IR, the facts, the last diagnostic and the append-only attempt log from disk.
The log is load-bearing rather than bookkeeping: without it fresh sessions oscillate between two
wrong answers and no single session can see it happening.

### The eleven modules

Named by responsibility, with the interface that matters. No file paths — the layout is the
implementer's.

1. **Contract reader.** Scenario contract → a parsed contract carrying objective, preconditions,
   setup, steps, an indexed list of Expected Outcomes, and style. Unknown `##` sections and HTML
   comments pass through and are ignored, deliberately, because that is where the authoring
   interview's answers live.

2. **Conventions scout.** Target repo plus a reachable tenant → **two outputs with two review
   standards**. A reviewed, committed conventions file holding the blessed vocabulary, the value
   builders, the API-setup idiom, the call shapes, the formatter invocation and the test-data
   prefix. And a generated reachability index that is a **cache**, not a reviewed artifact,
   because a stale entry there costs one probe run and self-corrects, where a stale entry in the
   conventions file ships.

   Three sets, not one: **available** is every command registered, **blessed** is what the tool
   may use, **idiomatic** is what humans in that repo actually write. The linter needs the split
   to give two verdicts — *not real* is a bug in the IR, *real but unblessed* is a question for a
   human.

   **The command list is probed, not grepped.** A throwaway spec dumps the Cypress command
   registry after the support file loads. This is exact by construction, and it is the only
   method that finds commands arriving through a third-party registration call, or that resolves
   the double-registrations whose signatures are incompatible. It costs the scout a tenant, which
   a grep would not, and it is what makes the linter's helper check sound.

   Each move carries its **binding** — `global`, `import` or `inline` — and its **kind**, proposed
   lexically by the scout and approved by a human. Quote style and indentation are **not**
   recorded: running the repo's own formatter reproduces its house style with zero profile
   fields.

3. **IR validator.** IR → verdict, in three layers that must not be collapsed. **JSON Schema**
   catches shape only. A hand-written **semantic linter** catches everything that matters —
   dangling references, a verb that does not exist, a helper that is not real, a probe-only
   construct in a spec-mode IR, a selector with no observed row behind it. The **anti-gaming
   guardrail** checks that every Expected Outcome has an assertion and that no outcome is
   satisfied by a value tracing to a `stub` in the same test.

   Ticket 03's sharpest finding governs this module: one capability addition once cut schema
   coverage from three planted defects caught to two, silently, with nothing failing. Validation
   that degrades invisibly is worse than none. Hence the corpus in Testing Decisions.

4. **Compiler.** IR plus conventions plus a mode → emitted TypeScript and a **source map**. Two
   back-ends that **share their setup emitters** — the moment probe and spec emit a blessed move
   differently, the fidelity argument that motivated the whole one-IR design leaks.

   Spec mode emits the house-style file that lands in the repo. Probe mode emits a throwaway
   spec that collects and asserts nothing. Probe mode **strips derived stubs and keeps blessed
   ones**, which makes it always integration-shaped. It resolves imports for its own throwaway
   location, not for a spec-tree path.

   Two constraints on emission, both load-bearing elsewhere: **one IR step compiles to exactly
   one statement**, never two steps to one, or the source map has a line range with two owners.
   And the model's flat step list is where the compiler, not the model, places the `.then()`
   blocks a capture needs.

5. **Ladder.** Candidate rows plus a declared cardinality → a path, or a refusal. **The primary
   key is uniqueness and the rung order is only a tie-break** — this is a path search, not a
   lookup. Six rungs, a ban list, a hard cap of three parts. A position is legal only inside a
   repeating list, measured by the probe and never guessed. Refusal fires on a **mismatch against
   declared cardinality**, never on more than one match alone.

   Uniqueness is measured against the collected surface, not the page. This is the module that
   carries ticket 02's invariant, upgraded three times over the design's life: from a check
   against a table, to a construction, to a verifiable link — a selector-bearing step names the
   row it derived from, and the linter checks that the ladder applied to that row reproduces the
   selector.

6. **Probe runtime.** Two custom commands — one that collects a scope into candidate rows, one
   that resolves a provisional selector and records which row it matched — plus one node task
   that writes the facts document, following the public plugin pattern the library already
   establishes. **Schema validation at the node boundary is required**: a malformed facts
   document is the input to every downstream decision and would otherwise fail silently.

   Facts are **one document per probe run, with entries individually cache-keyed** by tenant URL,
   application version and the establishing IR prefix, plus a TTL backstop. Per-run keying is the
   expensive kind of wrong. A probe that dies partway still returns what it already collected —
   this is normal, not exceptional, and it is why a wrong provisional guess costs progress rather
   than the run.

7. **Cypress driver.** A spec path plus a configuration override object → a run result. It uses
   the programmatic module API, not a bare CLI call, because it must override the spec pattern
   and the three asset folders in the same object. Retries are forced to zero for scoring.

   **The failure text is parsed for its location before it is truncated, and truncated in the
   middle.** There is no structured location field anywhere in the result — one regular
   expression over one string is the entire mechanism, and the stack frames sit at that string's
   end. v1 truncated head-first, which deletes the source-map key on exactly the largest
   failures. Resolution rule: take the topmost stack frame whose file is the emitted spec.

8. **Agent loop.** A manual loop over the messages endpoint. Not the Tool Runner: it signals
   iteration-budget exhaustion with a bare break and its count is a private field with no
   accessor, so it cannot distinguish *the model finished* from *the runner gave up* — a
   distinction the budget and the stop conditions both require. Not the Agent SDK: it exposes no
   cache-control API, and it ships filesystem and shell tools on by default, against a design
   whose entire safety argument is a closed surface.

   **The harness runs Cypress; the model does not.** v1 ran this experiment by accident — its
   model had a run tool *and* the harness re-ran independently, so every attempt cost two runs.
   The harness re-run is required by the anti-gaming guard. Under a budget denominated in Cypress
   runs, a model-callable run is a model-callable budget.

   Three cache breakpoints, one per stability tier: the tool definitions and system block; the
   scenario contract; the per-iteration tail. One-hour TTL on the first two, default on the third.
   The static bytes are read once per process and passed verbatim — the hazard is normalisation,
   not liveness, and the schemas ship as literal bytes rather than being rebuilt at request time.
   The progress line reads like an instruction and must stay in the suffix; putting it in the
   system block invalidates the whole prefix every iteration.

   Model: `claude-opus-5`, pinned, with high effort and thinking never disabled. Tiered effort is
   structurally unavailable — an effort change always invalidates the cache — which reinforces the
   one-model decision mechanically.

9. **Attempt log.** Append-only, one entry per iteration, holding the full IR snapshot, the
   changed field paths **computed from the diff rather than claimed**, the run produced, the
   failing step path, the capped diagnostic, the accept/reject verdict, the source map, the stop
   condition if any, the per-iteration usage record with the price-table version, the prefix hash,
   and the model-turn count. Kept in full, for every run including green ones.

10. **Scorer.** Emitted spec plus contract plus run result → a verdict on **axis A** (green, first
    attempt, retries disabled) and **axis B** (every Expected Outcome maps to a concrete
    assertion, checked independently of what Cypress reported). Axes C and D are graded by a human
    for this slice.

11. **Working area manager.** One ignored directory at the target repo root holding the lock, the
    facts cache, the throwaway probe specs and the per-run directories. Probe specs live under a
    spec-pattern override, which makes them structurally incapable of being picked up by the
    repo's own suite. The output path is a **pure function of the contract path**, which is what
    kills the duplicate-spec class of bug structurally rather than by cleanup. The emitted spec is
    written at its final path from the first iteration — it cannot be staged elsewhere, because a
    third of the host repo's specs import relatively and would not resolve — and deleted unless
    the run ends green. One rule covers every collision: **write only to a path that is empty or
    carries a matching provenance header.**

### The two injected boundaries

Everything metered sits behind an interface: **runs Cypress**, and **calls the model**. This is
the decision that makes the rest of the pipeline testable, and it is the only structural
concession this plan makes to testability. Both have exactly one production implementation.

### B0 runs in integration style — the contract's own `Style` line cannot be honoured

B0's scenario contract, salvaged verbatim from v1, declares `Style: mocked`. The benchmark's
oracle table and its preconditions section both say integration, and require a writable tenant.

**The design settles this against the contract.** Under mocked style the event is served by a
stubbed intercept, so outcomes 4 through 7 assert values that trace to a `stub` in the same test
— which the anti-gaming invariant forbids outright. A mocked B0 is not merely a different style;
it is unbuildable under the design's own rule.

So the slice generates B0 in integration style, and the stale `Style` line is raised as a
separate correction rather than fixed here, because ticket 01 froze that file deliberately to
keep the regression-floor comparison honest. This is the one genuine contradiction between two
committed artifacts that assembling this plan surfaced.

### One consequence worth naming before it is measured

Ticket 02 requires a generated spec to reset the state it created. **B0's hand-written oracle
does not** — it creates a device and never deletes it, and it is one of seven host specs that do
this. So a correctly generated B0 will carry a teardown the reference lacks, and axis C grades
flow equivalence partly on *no tenant mutation the reference does not make*. Whether a delete the
oracle omits counts against flow equivalence is a grading question that has never had to be
answered, because the benchmark has never been run. Flag it in the first scored run rather than
pre-deciding it.

## Testing Decisions

### What makes a good test here

A test asserts on what a module produces, never on how it got there. At the IR seam that means
feeding an IR document and asserting on the emitted TypeScript, the linter's verdict, or the
source map's contents — never on the order the compiler walks steps or which helper it calls. At
the facts seam it means feeding candidate rows and a declared cardinality and asserting on the
path that comes out — never on the ladder's search order or its scoring internals. Both seams
take a document in and give a document out, which is what makes this discipline easy to keep.

The corollary matters more than the rule: **no test asserts that Cypress passes.** That needs a
tenant, and it is what the benchmark run is for. Tests cover the deterministic half exhaustively;
the metered half is covered by injection and by one real run.

### The two seams

**Seam 1 — the IR.** Everything the model authors and everything the compiler consumes crosses
it. It carries the three validation layers, both back-ends, the source map, the anti-gaming
guardrail, and the frozen-field diff check. It is the highest seam that is still cheap, and it is
where most of this design's risk lives.

**Seam 2 — the facts document.** The ladder is the other purely deterministic algorithm and it
cannot be reached through the IR, because facts flow *into* IR authoring, which is a model turn.
A test feeds recorded candidate rows and asserts on the resolved path.

**The injected boundaries are not assertion seams.** They exist so that the loop can be driven
end to end — contract in, verdict out — with a scripted model and a scripted run result, no
tenant and no API key. That test asserts on the sequence of artifacts the loop produced, not on
the fakes.

### Modules tested, and how

- **Contract reader, IR validator, both compiler back-ends, source map, scorer** — through seam 1,
  with document fixtures.
- **Ladder** — through seam 2, with recorded candidate rows.
- **Conventions scout** — its deterministic miner through fixtures; its registry-dumping probe
  needs a tenant and is exercised once, by hand, when the conventions file for the host repo is
  first produced and reviewed.
- **Attempt log, working area manager, budget counters** — through the end-to-end loop test with
  both boundaries injected.
- **Cypress driver** — through recorded run results, including the large-failure case that
  defeated v1's truncation.

### The broken-file regression corpus is mandatory

One planted defect per rule, asserted to be caught, **extended with every capability added**.
This is not a nice-to-have: ticket 03 found that adding one optional field silently cut schema
coverage from three defects caught to two, breaking the linter's verb detection and the
compiler's verb lookup at the same time — one capability, three breakages, nothing failing.

The corpus starts from what the prototypes already built and must at minimum keep catching: a
probe-only verb in a spec-mode IR, a provisional selector in a spec-mode IR, an outcome satisfied
by a collect, two verbs in one step, an unknown verb, a dangling outcome reference, a selector
with no observed row, an unbound runtime reference, a helper that is not real, a value builder
denied by a directory override, an IR with zero DOM steps, a diff reaching a frozen field, and a
diff restoring a value already tried and failed.

### Prior art

Four prototypes on this map already built exactly these corpora and are the models to follow:
the probe-mode prototype (8 of 8 planted defects caught), the conventions-scout prototype (7 of 7
corpus cases and 7 of 7 schema rejections), the selector-ladder prototype (10 oracle targets plus
a 7,402-selector corpus audit at 87.5% and 93.5% agreement), and the emission-target prototype
that established the corpus requirement in the first place.

For test mechanics rather than test design, v1's layout is the local convention: a unit-test file
beside each source file, under the repository's existing test runner configuration.

### Two standing checks

1. **A cache-read assertion in CI** — a second identical request must report a non-zero
   cache-read count. A caching regression is silent and expensive: requests keep succeeding and
   only the bill changes.
2. **The prefix hash in every attempt-log entry**, which with the token counts makes *why did this
   run cost more?* answerable from the log alone. It also diagnoses the two invalidators nobody
   had considered — cache isolation is per workspace, and a developer with uncommitted edits to
   the house-rules file silently gets their own namespace.

## Out of Scope

Deliberately excluded, with the consequence of each exclusion stated rather than implied.

- **The assist packet.** The seven trip conditions, the three evidence tiers, the one-envelope
  rendering, and the answer-by-commit protocol are all out. The loop still **stops and records
  which condition ended the run** in the attempt log, because without that a FAIL is
  undiagnosable. What is missing is the human-facing rendering, not the detection.

- **The heal rungs.** No patch turn, no re-probe on second failure, no frozen-field diff check on
  the live path. If the first emitted spec fails, the run ends and reports. **Consequence, stated
  plainly: ticket 15 established that B0 does not pass today, so a first-shot slice will most
  likely score FAIL.** That is still the informative first number — it measures whether the design
  can generate a correct spec in one pass — but if the goal shifts to reaching PASS, the patch
  rung is the first thing to add, and its frozen-field rule must arrive with it rather than after
  it. The frozen/free field split still belongs in the broken-file corpus now, so the rule exists
  before the path that needs it.

- **The run manifest and the sweep.** **Consequence: B0 is integration style, so every run creates
  a device and an event on the tenant and nothing deletes them.** On a personal preprod tenant
  under the house test-data prefix this is a small, reversible, visible cost. The cheapest partial
  mitigation, if it becomes annoying before the sweep is built, is the manifest's static half —
  written from the IR before anything runs, so it cannot be crashed out of.

- **Every oracle but B0.** B1's intercept-writing tier, B2's render-branch hazard, B3's open-mode
  grading and B4's plugin tier are all out, and with them the three intercept verbs, fragments,
  render-branch handling, and plugin loading.

- **The plugin target repo.** Host repo only. The conventions scout is built to be repo-general
  but is exercised against one repo, and the measured fact that the plugin repo's reachability
  index seeds nothing is not a problem this slice has.

- **The contract genre.** Out of scope for v2 entirely, by ticket 05. v2 **refuses** it at lint
  time on IR shape — zero DOM steps — rather than attempting it. The refusal is a behaviour and
  belongs in the corpus now; the genre itself never arrives.

- **Replay against recorded traffic.** Declined by ticket 04. The slice heals against a live
  tenant, and `c8yctrl` is not a dependency.

- **The authoring interview as a shipped artifact.** The skeleton scenario file and its seven
  questions are out. B0's contract already exists and is frozen.

- **The design record.** Ticket 16's nine normative files are a separate piece of work. This plan
  cites the tickets directly instead, which is what the record would have done on its behalf.

- **Cost estimation before a run.** Ruled out of the map and handed to this effort, but it needs
  the baseline this slice produces. It cannot be built first.

## Further Notes

### Measure first, and the first measurement is free

Before anything is built, run the real token counter against a real assembled prompt. The
four-bytes-per-token conversion behind every payload figure in the design is likely about 30% low
for the models in question. It costs nothing, needs no tool, and repairs every cost figure at
once. Do it before quoting any number as measured.

Then B0. Three further numbers fall out of the first real run and should be captured deliberately
rather than noticed later: the **probe runs B0 actually needs** (the cap is three and the
structural claim is one, which fires ticket 02's tripwire if exceeded); the **per-iteration output
token count** (41–46% of the bill and the least-supported number in the arithmetic); and the
**start-to-start gap between Cypress runs** (the whole one-hour TTL choice turns on whether it
exceeds five minutes, and there is no clock anywhere in v1).

### Not a v1 baseline

Do not make v1 run the benchmark for comparison. v1 is reference-only with the burden of proof
reversed, and building a v1 score is real work spent on an architecture already replaced. An
uninterpretable first v2 number is cheaper than a v1 number nobody will build on.

### The tripwires that stay watched

These are conditions, not tasks, and they should sit where a session sees them every time rather
than in a backlog where one gets ticked done and stops being watched:

- More than roughly three probe runs for one scenario reopens the Cypress-probe decision.
- A generated spec failing on an ambiguous match that the probe declared unique reopens the
  collect-scope rule.
- A scenario that cannot be expressed without branching on live page state reopens the
  no-conditionals limitation.
- Tenant flake measured as a material cause of budget exhaustion reopens replay — and only that
  axis reopens it; cost does not.
- A real failure yielding no parseable frame inside the emitted spec reopens the source map's
  shape.
- Per-iteration cost observed rising through a run points at the attempt log's full-IR snapshot,
  not at the caching strategy.
- A session observed breaking a cross-cutting invariant that the standing context states reopens
  how much standing context is enough.

### On the shape of the first number

A FAIL on B0 is a successful outcome of this plan, provided the attempt log explains it. The
design has spent sixteen tickets arguing without a single measurement; the value of this slice is
the measurement, not the verdict. The one outcome that would waste it is a run whose failure
cannot be attributed — which is why the attempt log, the source map and the parsed-before-truncated
diagnostic are in scope even though the heal path that consumes them is not.
