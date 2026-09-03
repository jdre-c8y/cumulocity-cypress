# c8y-cygen v2

The ubiquitous language of the c8y-cygen v2 design effort: an LLM-agent-driven generator of
Cypress E2E specs for Cumulocity UI applications and plugins, built from ground truth harvested
from the running application rather than from source.

Scoped to this directory rather than the repo root on purpose — `cumulocity-cypress` is a
published library with its own domain, and this effort is a planning artifact living beside it.
Terms enter this file only when a ticket **settles** them.

## Language

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
A supported outcome, not a failure: the tool stops and hands a human a specific question. Fires
at six named trip conditions.

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
The append-only record each stateless session reads, without which fresh sessions oscillate.

**Oracle**:
One of the five hand-picked benchmark scenarios. Four have a hand-written reference spec; the
hard tier has none, because production never has one either.
