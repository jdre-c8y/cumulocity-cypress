# Emission target: TypeScript spec, declarative DSL, or hybrid?

Type: prototype
Status: resolved
Blocked by: 01

## Question

The single most load-bearing decision on this map. It determines what self-heal
operates on, what can be validated *before* anything runs, what a human reviews, and how
surgically a failure can be patched.

Three candidates:

- **(a) TypeScript Cypress spec** (v1). Lands directly in the target repo, matches
  house style, no translation layer. But it is only validatable by *running* it, and
  patching it means an LLM editing arbitrary code.
- **(b) A declarative DSL**, schema-validated before execution. Precedent exists in this
  very library: `c8yscrn` takes a YAML workflow with a generated JSON Schema and IDE
  autocompletion, explicitly so people get browser flows "without writing Cypress tests
  or Cypress know-how". Its real vocabulary is ten verbs — `blur, click, fileUpload,
  focus, highlight, screenshot, scrollTo, text, type, wait` across 8 schema definitions
  — with **no assertion or intercept language**. So this is a genuine extension, not a
  tweak, and per the packaging constraint it cannot be done by modifying `c8yscrn`
  itself.
- **(c) Hybrid** — a declarative intermediate representation the agent emits, compiled
  to a house-style TypeScript spec that is what actually lands in the repo.

Prototype this rather than argue it: take one oracle from ticket 01 and express the same
test all three ways. Judge on:

- **Pre-run validation** — how much can be caught without a tenant round-trip?
- **Patchability** — given "expected 9, found 1" plus a screenshot, how surgical can the fix be?
- **Reviewability** — which artifact would a teammate rather read in a PR?
- **House-style fidelity** — the output must look like the 246 specs already in `cumulocity-ui`, and *also* like the differently-styled specs in `c8y-ai-agents`.
- **Assertion expressiveness** — the anti-gaming guardrail requires every Expected Outcome to map to a concrete `.should(...)`. Can a DSL still support that check?

A DSL that cannot express what a hand-written spec expresses has failed, however clean
it looks.

## Answer

**Decision: (c) — the agent emits a declarative intermediate representation, which a
compiler turns into a house-style TypeScript spec. TypeScript is what lands in the
target repo.**

Prototype (primary source, not for merge): branch **`prototype/03-emission-target`**,
commit `171af62`, at `.scratch/c8y-cygen-v2/prototypes/03-emission-target/`. Runnable
with `node run.mjs`. Oracles B2 and B4 each expressed all three ways, with a harness for
the two claims that can be tested rather than asserted.

### Why (c) over (a), (b), and (d)

(d) — TypeScript plus a sidecar outcome→assertion map — emerged during the prototype and
was a genuine contender; it gets the static guardrail with none of the machinery. It was
rejected because (c) matches it on every axis and beats it on patchability.

| axis | result |
|---|---|
| pre-run validation | (b) = (c) > (d) > (a) |
| patchability | (b) = (c) > (a) = (d) |
| reviewability in a PR | (a) = (c) = (d) > (b) — every existing spec in both repos is TypeScript |
| house-style fidelity | (a) = (c) = (d) > (b) — (b) produces no spec at all |
| assertion expressiveness | (a) = (d) > (c) = (b) |

(b) was rejected on a cost the ticket had not named: if the DSL *ships*, something must
execute it, and the 200 existing `cumulocity-ui` specs plus 11 in `c8y-ai-agents` stay
TypeScript — so the repo would carry two kinds of test.

### The convergence check, and its pre-registered criterion

The recommendation was held back pending an explicit test: **if B4 needed zero new verbs,
(c) is safe; two or more, take (d).**

**B4 needed 0 new verbs.** Criterion met. B4 differs from B2 in every respect — plugin
not app, integration not mocked, low `[data-cy]` coverage, state-dependent labels, per-test
setup where B2 had none — and every action mapped to a verb B2 already established.
The action vocabulary converged, which was the thing genuinely in doubt.

Fragments paid off beyond expectation: B4's oracle repeats the add-a-provider cycle twice
across 88 hand-written lines; as one parameterised fragment invoked twice, the IR compiles
to **46 lines** — less duplication than the human wrote.

**But the risk was mis-framed.** Growth is in *properties*, not verbs: B4 needed 8 new
properties on existing verbs plus a `setup:` section, and a 9th (environment references,
for `Cypress.env('remotes')`) is still outstanding. Machinery growth for a whole new
oracle kind: compiler +44 lines (+28%), linter +9, schema +28 paths.

### Two hard requirements this decision now carries

Neither was in the ticket's framing. Both are non-optional consequences of choosing (c),
and both were discovered by building rather than reasoning.

**1. A source map from emitted assertions back to IR steps.** Cypress reports failures
against the emitted code, which under (c) is a build artifact. Without a source map, a
diagnostic cannot name an IR field path, and the model is back to string-matching the
failure against the IR — no better than (a), but with an extra layer in between. The
entire surgical-patch argument rests on this.

**2. A broken-file regression corpus for the schema and semantic linter, extended with
every new capability.** This is the sharpest finding of the session. Adding one
capability — the optional step `id` — forced the schema's `maxProperties` from 1 to 2.
That constraint had been doing double duty, also enforcing "exactly one verb per step".
Schema coverage silently fell from 3 planted defects caught to 2. Nothing failed, no
error appeared; the machinery simply got weaker. The same addition also broke the
linter's verb detection and the compiler's verb lookup — **one capability, three
breakages.** A validation layer that degrades invisibly is worse than none, because
people stop looking.

### Facts later tickets depend on

- **The IR is the patch surface.** Recovery operates on IR field paths, not on TypeScript.
- **Pre-run validation splits in two.** JSON Schema catches only shape; every defect that
  matters (dangling intercept alias, missing fragment, unbound fragment param, an outcome
  no assertion satisfies) needs a hand-written semantic linter. Cheap, but hand-written.
- **The anti-gaming guardrail becomes a static check** — outcome→assertion mapping is
  verifiable before anything runs. In v1 it could only run after generation.
- **Outcomes must reference stable step `id`s, never indices.** While authoring B2's flow
  all four `satisfiedBy: ['steps[N]']` references were off by one; the guardrail caught
  exactly one — the only one that landed on a non-asserting step. The other three pointed
  at the wrong assertion and validated clean.
- **The compiler needs a real string emitter, not a quote preference.** A style profile
  naming `"` as preferred emitted `cy.get("[data-cy="…"]")`, which does not parse.
  `[data-cy="…"]` selectors are pervasive.
- **Variable interpolation must iterate to a fixed point** — variables reference variables
  (`appPath` contains `${remotes}`).
- **A fragment parameter must carry the matcher *kind*, not just the text.** B4's oracle
  uses a regex on the first call (label is state-dependent) and a literal on the second
  (state now known); one parameter has to express both.
- **The per-repo style profile is load-bearing under (c)**, where it would have been
  advisory under (a). This is a hard dependency on
  [Conventions scout: what it captures, and its output format](06-conventions-scout.md).
