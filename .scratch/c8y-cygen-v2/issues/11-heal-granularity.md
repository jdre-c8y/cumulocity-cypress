# Heal granularity: what is the unit of recovery?

Type: grilling
Status: resolved
Blocked by: — (10 resolved)
Assignee: jdre

## Question

Graduated from fog once [Emission target](03-emission-target.md) settled. That decision
established the patch surface — **recovery operates on IR field paths, not on
TypeScript** — which turns a vague question ("re-derive or patch?") into a sharp one
about units.

The prototype demonstrated the mechanics concretely: under a real B2 failure, the fix was
`steps[7].useFragment.with.selector`, a single addressable field, applicable without a
model writing code and re-validatable by schema plus linter before any tenant round-trip.

Resolve:

1. **What is the unit?** Options: re-emit the whole IR from the facts; patch one step;
   re-run one fragment; re-gather ground truth for one selector and patch. These are not
   exclusive — the answer may be a ladder that escalates.
2. **How is escalation bounded?** v1 re-ran whole self-heal attempts and silently
   exhausted its budget three times. What stops a patch loop from cycling — a per-step
   attempt cap, a distinct-diagnostic requirement, a total budget?
3. **What does the patcher receive?** The prototype's finding is that a text diagnostic
   alone was mostly guessing in v1; the *why* was only ever visible in the Cypress
   screenshot. So: diagnostic text, screenshot, the IR step, and what else — the
   harvested facts for that selector? the DOM at failure?
4. **When does it stop and ask a human?** The assist path is a supported outcome. What
   condition triggers it — attempts exhausted, the same diagnostic twice, a diagnostic
   class known to be unfixable without eyes?
5. **Does a patch invalidate validation state?** After patching one field, does the whole
   IR re-validate, or just the touched step? Cheap either way, but the answer affects
   whether the guardrail is re-checked on every patch.

**Hard dependency, carried from ticket 03:** all of this requires a **source map from
emitted assertions back to IR steps**. Cypress reports failures against compiled output,
so without that map a diagnostic cannot name a field path and this ticket's entire premise
collapses back to string-matching. Treat the source map as a given requirement, not an
option — but this ticket should state what it must contain.

---

## Constraints from ticket 10 (loop shape)

Ticket 10 settled *when* recovery happens; this ticket owns *what it inspects and changes*.

- **`Q9(c)`: patch directly on the first failure, re-probe on the second.** So this ticket
  does not decide whether to re-probe — it decides what a re-probe looks at (the failing
  step only, the whole flow, or the state at the point of failure) and what the patch is
  allowed to touch.
- **The diagnostic's content is this ticket's to specify.** v1's `CypressRunResult` carried
  `{ title[], errorMessage, screenshotPath? }` with `MAX_ERROR_MESSAGE_CHARS = 3000` and
  `MAX_SCREENSHOTS_PER_RETRY = 2`. Ticket 03's source map adds the field v1 lacked —
  **which IR step failed**. Whether that is enough, and what else a failure must carry, is
  the core question here.
- **Sessions are stateless (`Q3(b)`) and read an append-only attempt log (`Q7(b)`).** A
  patch is therefore authored by a session that never saw the reasoning that produced the
  bug — only what the log records about it. What the log must capture per attempt for a
  patch to be well-founded is partly this ticket's problem and partly ticket 13's.
- **Budget is ≤6 Cypress runs total, ≤3 of them probes.** Healing shares that budget with
  acquisition; a heal strategy that needs more than about two attempts does not fit.
- **The linter is the stop condition (`Q8(b)`)**, so a patch that breaks the
  observed-selector invariant fails locally and costs no run. Recovery can therefore be
  attempted freely as long as it lints — the metered resource is the run, not the attempt.


---

## Answer

Resolved by grilling, three rounds (Q1–Q16 below are the grilling questions, not the five
in the body above; the body's five map onto the sections that follow).

**The unit of recovery is a bounded diff on the IR — and the model never authors a
selector inside it.** The ticket asked whether to re-emit, patch a step, re-run a fragment
or re-gather. The answer is a two-rung ladder whose rungs differ not in *size* but in
**where the information comes from**: rung 1 spends no run and may only re-arrange facts
already observed; rung 2 spends a probe run because new observation is the only legal way
to learn anything new.

### The two rungs

```
spec run fails
  → source map: line → step path
  → rung 1: PATCH        re-point the step at another observed candidate row,
                         or adjust scope / index / timeout / fragment args / add a settle
  → spec run fails again
  → rung 2: RE-PROBE     demote the selector to `provisional`, re-observe, let the
                         ladder resolve it
  → spec run
```

Ticket 10 fixed the rung order (`Q9(c)`, patch first, re-probe second). This ticket fixes
what each rung may look at and may touch.

### The source map is a sidecar, and it is parsed before it is truncated

**`Q1(a)`.** A JSON sidecar in the working area: **emitted line range → step path**. The
committed spec is not touched, so house-style fidelity — ticket 03's whole reason for
choosing (c) — is unaffected, and the map dies with the IR as a build artifact.

Four requirements, three of them from measurement rather than reasoning:

1. **A line range, not a line.** The emitted spec has multi-line chains, and a failure
   inside one names the `.should(...)` line, not the `cy.get(...)` line that opens it.
2. **The value is a step *path*, not an id** — `steps[7] > fragments.verifyTimelineValue.steps[2]`
   — so a fragment failure says whether the bug is at the call site or in the body. The
   prototype compiler expands fragments inline, so each emitted line has exactly one owner;
   the "which of two identical call sites?" problem that sank candidate (a) does not return.
3. **One step compiles to one statement, never two steps to one.** A constraint back on the
   compiler, free today because it already emits that way, and load-bearing because a line
   range with two owners makes the map ambiguous exactly where it is needed.
4. **Parse the location before truncating, and truncate the middle.** See *Found by
   measuring*.

Resolution rule: **take the topmost stack frame whose file is the emitted spec.** A failure
raised inside a blessed helper still names the step that called it, and a failure in a
`beforeEach` names its setup entry — both measured, neither needing a special case. The map
also carries the spec's content hash, so a stale map is caught rather than trusted, and the
outcome ids each step satisfies, which is a lookup rather than new data (ticket 08 already
made each assertion declare its Expected Outcome).

The map survives an assist: ticket 09 keeps the red spec file in the working tree, and the
packet cannot name a step without it.

### A patch is a diff, and the diff is checked

**`Q2(b)`.** The model rewrites the IR as it always does — ticket 10 left exactly one kind
of model turn, and this does not add a second. The tool then **diffs the previous IR against
the new one and rejects a diff that reaches outside the allowed set**. No patch-operation
language, no second authoring mode.

This is the linter-as-stop-condition pattern reused: a rejection costs a model turn and
never a Cypress run, and ticket 10 established that the run is the metered resource. It also
produces the record an advisory prompt cannot — the changed field paths, **computed rather
than claimed**, which is what a later stateless session needs in order to see an oscillation
it did not participate in.

### Frozen and free: healing has an attack that generation does not

**`Q3(b)`.** The linter proves an Expected Outcome *has* an assertion. It never proves the
assertion is as strong as it was. Generation never had to care, because it authored once.
Healing is authoring **under pressure to turn a red thing green**, and the cheapest available
fix to *"declared 3, observed 1"* is to declare 1 — which lints clean, passes, and is exactly
the fabrication the whole anti-gaming apparatus exists to stop.

So a patch splits the IR in two:

| | fields |
| --- | --- |
| **Free** (mechanics — *how the step finds its target*) | `within` scope, index, timeouts, a fragment invocation's `with:` args, **inserting** a step, the candidate-row reference (below) |
| **Frozen** (intent — *what the step asserts*) | outcome text and ids, `satisfiedBy`, an assertion's extractor / comparator / operand, declared cardinality, an existing step's verb, **deleting any step** |

A `var` referenced by any frozen field is frozen too, or the operand escapes through `vars`.

**Adding an assertion step is free; removing or weakening one is frozen.** An addition
cannot weaken anything, and rung 2 needs additions — new facts routinely reveal a render
branch the first probe never saw, which needs a step to reach it.

Rejected: bounding to the failing step's subtree alone (`Q3(a)`) — it forbids the fix that
lives one step upstream, which is most of them. Held for later: allowing a *provably
stricter* intent edit over ticket 15's closed comparator list (`Q3(c)`) — real, cheap, and an
optimisation on a path that should be rare.

### The model never authors a selector — in generation or in healing

**`Q9(b)`, with `(c)` as rung 2.** This is a **correction to `Q3` made mid-session**: as
first written, the mechanics zone let a patch turn write a selector string. Ticket 12 does
not permit that. It made resolution *deterministic* — the probe records which candidate row
each provisional matched and the ladder derives the selector — which "inverts ticket 02's
invariant from a check into a construction, making a hallucinated selector impossible rather
than detectable." A hand-written selector on the heal path re-opens the exact hole
generation closed, on the one path where the model is most motivated to guess.

So a selector is never edited. It is **re-pointed** or **demoted**:

- **Rung 1 — re-point.** The model names a different candidate row the probe already
  observed. A choice among enumerated facts, the same shape ticket 12 gave the ambiguity
  assist.
- **Rung 2 — demote.** The model sets the selector back to `provisional`; the re-probe
  observes and the ladder resolves. The model contributes a structural guess, never a
  committed selector.

**This costs one new IR property and is not optional under `Q9(b)`:** a selector-bearing step
must **name the candidate row it was derived from**. You cannot choose a row without naming
one. The literal selector stays in the IR — an IR of row keys is unreviewable, and the spec
must not depend on the facts file to be read — so the row reference sits beside it as
provenance. The linter then checks `selector == ladder(row)`, which upgrades ticket 02's
invariant a second time: from a check against a table, to a construction, to a **verifiable
link**.

### Escalation is bounded by the run, not by the step

**`Q6(b)`.** The counter is **per spec run**, not per step. Forced by a measured fact:
Cypress stops an `it()` at the first failure, so **one spec run yields at most one
diagnostic**, whatever else is broken downstream. A per-step counter lets a flow with four
wrong selectors consume four patch runs and blow the 6-run cap; one re-probe re-collects
everything from the failure point and fixes them together. It is also exactly ticket 10's
pinned shape — probe, fail, patch, fail, re-probe, pass = five runs, one spare.

*"Patch first, re-probe second"* therefore turns out not to be a policy about steps at all.
It follows from the fact that a run reveals one failure.

**`Q16(b)`: a probe run that dies partway is not a failure and does not advance the
counter.** Ticket 12 made dying partway normal — a probe returns what it collected, and a
provisional that matched nothing is information. A probe has no assertions, so it has nothing
to fail. The two budgets are separate (≤3 probe, ≤6 total) for this reason.

**`Q5(a)`: a re-probe re-runs the whole flow** in probe mode, with collect points added at
and after the failing step. Narrowing to the failing step saves nothing — reaching it
requires every preceding step to execute, so it is the same run — and everything after the
failure is unverified anyway, because Cypress stopped there. No new machinery: the same IR
through ticket 12's back-end.

**`Q10(b)`: skip the patch when no observed row fits, and re-probe at once.** B2's real
hazard is a render branch — after switching to Maximum mode the element is a *different*
element, and ticket 02's `Q8(c)` deliberately declined preventive second-state observation,
so the first probe never saw that row. Patching first would burn a spec run guessing.

**Stated honestly: this is the one place in the recovery path where a model judgement
replaces a check.** "No fitting row exists" is declared by the model, not computed — unlike
the linter stop condition it is modelled on. It is bounded by the probe cap and its failure
mode is a wasted probe run rather than a wrong spec, which is why it is acceptable; it is not
free the way the linter is.

**`Q14(b)`: a diff that restores a field to a value already tried and failed is rejected.**
Ticket 10 made the attempt log load-bearing because without it "fresh sessions oscillate —
flip a selector, fail, flip it back, fail." The log makes that *detectable*; only a check
makes it *impossible*. It costs no run, it is computable from the log, and it converts v1's
measured failure mode into a lint verdict instead of a hope about prompt compliance. v1
effectively had `(a)` — the whole transcript, not a log — and oscillated anyway.

**`Q13(b)`: the log holds a full IR snapshot per attempt**, plus the changed field paths, the
run it produced, the failing step path and diagnostic, and whether the diff was accepted or
rejected. Tens of lines, at most six attempts, and hygiene already keeps logs forever;
reconstructing an earlier IR by replaying diffs backwards saves nothing worth a code path
that can drift from what it reconstructs.

### What the patch session reads — and the one thing it must not

**`Q4`.** The contract, the conventions file, the current IR, the facts, the attempt log, the
capped diagnostic **with the resolved step path**, the failing emitted line verbatim, the
screenshot, and **the candidate rows for that step's collect scope** — rows, not ticket 07's
summary, because the scope of a heal turn is one step and choosing a row is the whole move.

**Not the DOM at the moment of failure.** Hand a model live HTML and it will lift a selector
out of it, which is the thing ticket 12 made structurally impossible. Screenshots stay —
v1's finding was that the *why* was visible only there, and a picture is safe under the
invariant because an attribute cannot be read off pixels.

That line is also *why* rung 2 exists. A re-probe is not "look harder". **It is the only
legal channel for new observation**, and every fact it returns arrives through the candidate
table and the ladder.

Not the whole emitted file either. The diagnostic already carries the failing line.

### Validation: the whole IR, every time

**`Q7`.** Schema, semantic linter and anti-gaming guardrail re-run over the entire IR after
every patch. It is a local parse against no tenant. Ticket 03's sharpest finding was that
validation machinery which degrades invisibly is worse than none, and an incremental path is
a second code path with its own coverage to lose.

The `Q2` diff bound and the `Q3` zone rule are **new linter rules**, so they run in the same
place and belong in the same broken-file regression corpus ticket 03 made mandatory.

### Assist: a seventh trip condition

**`Q12(a)`.** *"The app contradicts the scenario"* is a **seventh** condition, not a variant
of an existing one. It is not condition 2 (a required selector absent) — the selector
resolved and the element is in the table. It is not condition 3 (an outcome cannot be
mapped) — that fires at lint time with no diagnostic, and ticket 13 has already split its
packet on exactly that line. This one arrives with a diagnostic, a screenshot and a step
path, and it asks the sharpest question in the set: *"the page shows 1, the scenario says 3 —
which is wrong?"* Answered by a human in seconds, unanswerable by a model at any price,
because the scenario's intent exists in no artifact it can read.

**`Q11(c)`, cap 1.** The model may return an **assist request instead of an IR**, which fires
the condition with no wasted turn. The rejection cap is the backstop: one rejected diff is
re-prompted with its reason, a second on the same failure fires assist. The cap exists
because a model retrying a frozen edit loops for free — free in *Cypress runs*, which is the
one resource the budget does not meter.

**`Q15(b)`: if the re-probe's ladder resolves to the selector that just failed, fire assist
without spending the run.** The element is there and the selector is right, so the failure
was never a selector problem, and re-running would fail identically with 4–5 of 6 runs
already gone. The packet is unusually strong here — *"this selector is correct, the probe
just observed it, and the assertion still fails"* — which is a better question than any
earlier run could have produced.

### Healing a stale committed spec is regeneration, not healing

**`Q8(a)`.** Within a run the IR is on disk in the working area, so healing never needs a
previous run's IR. Across runs, a spec that goes red three weeks later is **regenerated from
its contract** — ticket 09 already made the output path a pure function of the contract path,
and the provenance header already says whether a human has touched the file. Keeping the IR
beside the spec adds the fourth committed artifact hygiene refused, and it drifts the moment
someone edits the `.ts`.

**So this ticket does not reopen the map's *"re-deriving the IR from the contract is cheap"*
assumption** — the thing it was named as the possible trigger for. It narrows it instead: the
claim that has to hold is only that regeneration is cheap, never that a patch would have been
cheaper.

### Found by measuring

Ticket 03 made the source map a hard requirement without checking what Cypress actually
reports. A standalone Cypress 14.5.4 TypeScript project, four failure kinds, run through the
module API:

1. **Line numbers are original `.ts` lines**, in all four cases — plain assertion, multi-line
   `cy` chain, cross-file helper throw, `beforeEach` throw. Cypress resolves the webpack
   source map browser-side before the JSON is assembled. The sidecar map works.
2. **A multi-line chain names the `.should(...)` line, not the opening `cy.get(...)`** —
   `probe.cy.ts:11:7` for a chain starting at line 10. Line *ranges*, and never keyed on a
   statement's first line.
3. **A cross-file throw still produces a spec-file frame** (`helper.ts:5:8`, then
   `probe.cy.ts:15:20`, the call site). The topmost-frame-in-the-spec rule resolves it.
4. **A hook failure carries an exact line into the `beforeEach` body**, so a failing setup
   move maps to its setup entry by the same rule. Only the *fact* that it was a hook is
   prose-only inside `displayError`, and nothing here needs it.
5. **The defect: `displayError` is the only structured error text there is.** `attempts[]` is
   `{ state }` and there is **no `codeFrame` field anywhere** in the module API — confirmed
   against the installed `cypress-npm-api.d.ts`, where `AttemptResult` is `{ state: string }`.
   So `file:line:col` must be regex-parsed out of one string, and **the stack frames sit at
   its end**. v1 truncated head-first: `message.slice(0, MAX_ERROR_MESSAGE_CHARS)` at 3000
   chars, with its own comment noting a diff asserting against full page HTML "can be as
   large as many turns of normal exploration combined (observed on a live run)."

   **Carried forward unchanged, v1's truncation silently deletes the source-map key on
   exactly the largest failures** — the ones where knowing the step matters most — and
   nothing reports it. Parse the location first; truncate the middle.
6. Incidental, and a trap for the implementation effort: unpinned `npm i -D typescript`
   installs **TypeScript 7.0.2**, which breaks Cypress 14.5.4's bundled `ts-loader`
   (`Cannot read properties of undefined (reading 'fileExists')`). Both target repos pin
   their own TypeScript; a scratch project must too.

Both target repos use the **default** e2e preprocessor — `cumulocity-ui-e2e`'s webpack block
is under `component:` — so the measurement is representative of both.

### Facts later tickets depend on

1. **A seventh trip condition** for [Autonomy handoff](13-assist-handoff.md): *the app
   contradicts the scenario*. Post-run, carries a diagnostic and a screenshot, and its answer
   is a decision about the **scenario**, not about the repo's vocabulary — so it does not
   join the vocabulary class ticket 15 collapsed. Five post-run conditions, two lint-time.
2. **Attempt-log fields this ticket requires**, for the same ticket: an IR snapshot, the
   changed field paths, the run produced, the failing step path, the diagnostic, and the
   accept/reject verdict on the diff. The rejected diffs matter as much as the accepted ones
   — they are the evidence that the model wanted a frozen edit, which is ticket 08's hazard
   stream.
3. **The compiler must not merge two IR steps into one emitted statement.** A line range with
   two owners breaks the map. Free today.
4. **`displayError` must be parsed before it is truncated**, and truncated in the middle.
5. **The source map and the red spec both survive an assist**, or the packet cannot name a
   step (ticket 09 already keeps the spec).
6. Cypress's machine-readable failure gives **no structured location field** — one regex over
   one string is the entire mechanism. That is the fragility the whole surgical-patch argument
   now rests on.

### What this adds

**Zero verbs. One IR property** — the candidate-row reference on a selector-bearing step,
forced by `Q9(b)`. **One build artifact** — the source map. **Two linter rules** — the diff
bound and the oscillation check, both belonging in the broken-file corpus. The `provisional`
demotion reuses ticket 12's existing property and adds nothing.
