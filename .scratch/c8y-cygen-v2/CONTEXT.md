# c8y-cygen v2

The ubiquitous language of the c8y-cygen v2 design effort: an LLM-agent-driven generator of
Cypress E2E specs for Cumulocity UI applications and plugins, built from ground truth harvested
from the running application rather than from source.

Scoped to this directory rather than the repo root on purpose — `cumulocity-cypress` is a
published library with its own domain, and this effort is a planning artifact living beside it.
Terms enter this file only when a ticket **settles** them.

## Language

### Authoring

**Scenario contract**:
The markdown document a human writes to ask for a spec. Six sections — Objective,
Preconditions, Setup, Steps, Expected Outcomes, and an optional Style. Only Expected Outcomes
and Style are read for meaning; the rest is read by the model. Unknown sections and comments
pass through untouched, which is where authoring annotations live. Committed, and stored
beside the spec it produces — it is the only durable input to a re-generation.
_Avoid_: input document, scenario doc, spec request

**Hazard**:
A property of a scenario that makes the generated spec expensive or flaky. It joins the list
only after it is observed in a real failure, and leaves when the design removes its cause. One
a machine can check becomes a check; one that needs human judgement becomes a question in the
authoring interview.
_Avoid_: pitfall, gotcha, smell

**Authoring interview**:
The questions put to a scenario's author while they write. Its output is not advice but
*content in the scenario contract*, placed next to the step it concerns. Deliberately not a
checklist: a checklist detects a hazard only where an expert had already annotated it.
_Avoid_: hazard checklist, scenario lint, review pass

### The pipeline

**Genre**:
What kind of spec is being generated. v2 has exactly one — **UI e2e**, whose ground truth is the
rendered page. The **contract genre** (pact roundtrips, asserted by a recorded response and a
JSON Schema) is not a second genre v2 supports: it is a separate effort, and v2 *refuses* it
rather than skipping it. The line is drawn by IR shape — **zero DOM steps** — never by directory
or by a human's declaration.
_Avoid_: mode, flavour, spec type

**IR**:
The declarative document the model authors. It is the only artifact the model writes, and it is
not code.
_Avoid_: DSL, script, plan

**Compiler**:
Turns an IR into runnable TypeScript. It has two back-ends and no model in the loop.

**Spec mode**:
The compiler back-end that emits the house-style spec which lands in the target repo.

**Probe mode**:
The compiler back-end that emits a throwaway spec which collects facts and asserts nothing.
_Avoid_: explorer, harvester

**Probe run**:
One execution of a probe spec. The only metered operation in the design, and therefore the unit
the budget is denominated in.

**Facts**:
What a probe run leaves behind. An ephemeral cached artifact, never committed.

### Ground truth

**Candidate table**:
One flat table of every element a probe observed. Each row carries its own ancestor list, so no
tree is ever needed and no DOM is ever shown to a model.

**Candidate row**:
One observed element. Keyed by its resolved path inside a table; keyed by the step that matched
it when a probe recorded it directly.
_Avoid_: node, element record

**Collected surface**:
The elements one collect point gathered, bounded by its `within`. Uniqueness is measured against
this and never against the whole page.

**Provisional selector**:
A deliberately fragile guess the model writes so that one probe run can walk a flow it cannot yet
name precisely. Probe mode compiles it; spec mode refuses it.
_Avoid_: placeholder, hole

### Runtime values

**Value builder**:
One entry in the closed vocabulary the IR draws runtime values from — `now()`, `uniqueName()`,
`isoTime()`. The IR holds no raw TypeScript, so a value that no builder can produce stops the run.
_Avoid_: expression, helper function

**Capture**:
A name bound to the result of a step. One concept with three emissions: a `.then()` block for a
value, `.as()` for a DOM subject, and nothing at all for an intercept, which is named by its step
id. A capture names a step, never a selector.
_Avoid_: alias, variable, binding

**Anchored**:
Every field of a fabricated body traces to the scenario contract, a capture, or a value builder —
nothing invented. The property that makes a `stub` and a setup `request` safe.

**Extractor / comparator**:
The two closed lists an assertion is built from. An extractor says what to read — off the page
(`text`, `attribute`, `value`, `count`) or off a response (`status`, `body.<path>`); a comparator
says how to test it (`equals`, `includes`, `matches`, `withinMinutesOfNow`). A response is read
by the same two lists as the page, deliberately: a schema is not an assertion here.

### Choosing a selector

**Ladder**:
The deterministic code that turns an observed element into the selector that lands in the spec.
It searches for the shortest path that is unique; the rung order only breaks a tie.

**Rung**:
One class of descriptor, ordered by how well it survives a UI change. Six of them, from
`[data-cy]` down to a position.

**Path**:
An ordered list of descriptors, outermost first, capped at three parts. What the ladder produces.
_Avoid_: selector chain, compound selector

**Cardinality**:
How many elements a step declares it expects. Refusal fires on a mismatch against this, never on
more than one match alone.

**Repeating list**:
Many neighbours sharing one element's own leaf descriptor. The only place a position is a legal
rung. Measured by the probe, never guessed.

**Render branch**:
One of the several ways a component can render itself. The same element may carry a different
`data-cy`, a different label, or a different clipped area in each.

### Running the loop

**Assist**:
A supported outcome, not a failure: the tool stops and hands a human a specific question. It
**ends the run** — nothing waits and nothing parks — and the answer comes back as a commit to
one of two files, the conventions file or the scenario contract, which the next run reads like
any other input. Fires at seven named trip conditions.
_Avoid_: escalation, pause, handoff

**Trip condition**:
One of the seven named states in which the tool stops and asks. Grouped by **evidence tier**,
never by which one fired. Budget exhaustion is the odd one out: a cap rather than a question, it
carries whatever the tier it stopped in already had.
_Avoid_: failure mode, stop reason

**Evidence tier**:
What decides an assist packet's sections — whether nothing ran, a probe ran, or a spec ran.
Three of them, which is why seven trip conditions produce three packet shapes and not seven.

**Assist packet**:
What a human reads when the tool stops. Not a stored artifact but a **rendering of the attempt
log**, so one record serves both its readers: the human answering now, and the human deciding
later whether a recurring stop has earned promotion to a hazard. It proposes an answer only from
a vocabulary the tool owns, offers a menu only of rows a probe observed, and otherwise shows
state — it never proposes a fact about the application. It always names the red spec's path, and
names *"the application is wrong"* as a legitimate answer.
_Avoid_: report, failure summary, handoff document

**Blessed vocabulary**:
The closed, per-repo set of setup moves a generated spec may use. The primary cost lever in the
design. One of three sets a repo has, and the only one a human curates: *available* is every
command that is registered, *blessed* is what the tool may use, *idiomatic* is what humans
there actually write. A move can be available and unblessed, or blessed and unidiomatic.
_Avoid_: whitelist, allowed commands

**Conventions file**:
The reviewed, committed, per-repo artifact the scout writes and every later run reads. Lives in
the target repo. Holds the blessed vocabulary, the value builders, the API-setup idiom and the
call shapes — never quote style or indent, which the repo's own formatter already owns.
_Avoid_: style profile, house style file

**Reachability index**:
The *generated* companion to the conventions file: proven navigation sequences mined from a
repo's existing specs. A cache, not a reviewed artifact, because it is read as priors and
always verified live. Kept separate because a stale entry here costs one probe run, where a
stale entry in the conventions file ships.

**Binding**:
How a blessed move reaches the emitted spec — `global` (a registered Cypress command, needing
no import), `import` (a module export), or `inline` (defined in a spec body and never exported,
so its source must be emitted).

**Attempt log**:
The append-only record each stateless session reads, without which fresh sessions oscillate. It
is also the only store an assist has, the packet being a view of it. Per iteration it holds the
IR snapshot, the changed field paths computed from the diff, the run produced, the failing step
path, the capped diagnostic, the accept/reject verdict, the source map, and the trip condition
if the run ended in one. The **rejected** diffs are the evidence that a model wanted to weaken
an assertion.

**Oracle**:
One of the five hand-picked benchmark scenarios. Four have a hand-written reference spec; the
hard tier has none, because production never has one either.

### Recovering from a failure

**Patch**:
One bounded refine turn after a failed spec run. The model rewrites the IR as it always does;
the tool diffs the result and rejects a change that reaches a frozen field. Rejection costs a
model turn and never a run.
_Avoid_: fix, retry, self-heal

**Frozen field**:
A field a patch may not change: *what* a step asserts, rather than *how* it finds its target.
Outcomes, `satisfiedBy`, an assertion's extractor, comparator and operand, declared
cardinality, an existing step's verb, and the deletion of any step. Everything else is free.
Adding a step is never frozen — an addition cannot weaken an assertion.
_Avoid_: intent zone, locked field, protected field

**Source map**:
What turns a Cypress failure into an IR step. A sidecar keyed by emitted line *range*, whose
value is a step *path*, so a fragment failure says whether the bug is at the call site or in
the body. A build artifact, kept in the attempt log so that it survives an assist.
_Avoid_: line map, trace, back-reference

**Demotion**:
Returning a resolved selector to `provisional` so a re-probe and the ladder resolve it again.
The only way a selector ever changes — the model re-points a step at another observed row or
demotes it, and never writes a selector itself.
_Avoid_: reset, unresolve, re-open

### Artifacts and cleanup

**Working area**:
The one gitignored directory in a target repo holding everything a run needs that is not
committed — probe specs, facts, attempt logs, run manifests, and the run's own Cypress
screenshots and videos. Inside the repo because a probe spec must be bundled by that repo's
Cypress project.
_Avoid_: scratch dir, temp, build dir

**Provenance header**:
The comment block an emitted spec carries: content hash, tool version, contract path. It is
what makes one rule sufficient — a path is written only when it is empty or its header
matches. A missing header means a human wrote the file; a stale hash means a human edited it.
_Avoid_: banner, generated marker

**Run manifest**:
A run's tenant footprint, in two halves. The *static* half is written from the IR before
anything runs, so it cannot be crashed out of; the *dynamic* half is appended from observed
`201` responses, and is the only half that sees state created by clicking.
_Avoid_: transaction log, cleanup list

**Sweep**:
Deleting a run's tenant footprint. It is the tool's own work, never emitted code, so it needs
no blessed move and no idiom. Runs at the end of a run, at the start of one against an
orphaned manifest, and on demand.
_Avoid_: teardown, which is what a *spec* does to its own state

### The design effort

**Design record**:
The hand-off artifact this effort produces. Nine normative files behind one front door, in
`packages/c8y-cygen/`, organised by the part being built and never by the order the questions
were asked. It states the rules and links the tickets that argued them; it cites this glossary
and the benchmark, and absorbs neither. Deliberately not called a spec — in this domain a
**spec** is the Cypress file that spec mode emits.
_Avoid_: spec, design spec, the spec document, handoff doc

**Standing block**:
The part of the design record that every session of the implementation effort loads, copied
into that map's Notes. It holds the Given, the cross-cutting invariants and the tripwires — not
a summary of the design, which is what the nine files are. Sized against the thing read
repeatedly, not the thing read once.
_Avoid_: preamble, header, overview

**Tripwire**:
A named result that reopens a settled decision. It is a condition to watch, never a task to
perform, which is why it lives in the standing block and not in a backlog — an entry in a
backlog gets marked done and stops being watched. Its opposite is a **measurement**: work with
a result, which does belong in a backlog.
_Avoid_: risk, caveat, open question, unvalidated assumption
