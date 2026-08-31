# c8y-cygen v2

The ubiquitous language of the c8y-cygen v2 design effort: an LLM-agent-driven generator of
Cypress E2E specs for Cumulocity UI applications and plugins, built from ground truth harvested
from the running application rather than from source.

Scoped to this directory rather than the repo root on purpose — `cumulocity-cypress` is a
published library with its own domain, and this effort is a planning artifact living beside it.
Terms enter this file only when a ticket **settles** them.

## Language

### The pipeline

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
at five named trip conditions.

**Blessed vocabulary**:
The closed, per-repo set of setup moves a generated spec may use. The primary cost lever in the
design.

**Attempt log**:
The append-only record each stateless session reads, without which fresh sessions oscillate.

**Oracle**:
One of the five hand-picked benchmark scenarios. Four have a hand-written reference spec; the
hard tier has none, because production never has one either.
