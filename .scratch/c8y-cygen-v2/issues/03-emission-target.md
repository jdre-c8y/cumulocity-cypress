# Emission target: TypeScript spec, declarative DSL, or hybrid?

Type: prototype
Status: open
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
