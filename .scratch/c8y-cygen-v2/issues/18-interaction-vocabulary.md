# The interaction vocabulary: c8y-cygen cannot fill in a form

Type: grilling
Status: open
Blocked by: — (raised by B2, which cannot be attempted without it)
Assignee: jdre

## Question

B0 and B1 both pass. Both are **read-only flows plus clicks**: navigate, open a panel, read
something back. B2 is the first oracle that *changes* a value, and reading its hand-written
reference stops the effort dead:

```ts
cy.contains('c8y-datapoint-selector-list-item', seriesName)
  .find('select[formcontrolname="renderType"]')
  .first()
  .scrollIntoView()
  .select(renderType)
  .trigger('change')
  .should('have.value', expectedSelectValue);
```

`VERBS` is `visit, click, settle, assert, callRepoHelper, request, stub, sync, waitFor, collect`.
There is no `type`, no `select`, no `check`. The conventions file blesses no input helper either.
**Nothing in c8y-cygen can put a value into a form control.**

This was invisible until now because the benchmark's first two oracles never needed it. That is
worth saying plainly: *the oracle selection hid a gap this large for the whole of v1's redesign.*

## Measured first

213 hand-written specs, both repos, generated files excluded.

| Cypress verb | calls | specs | share of specs |
| --- | --- | --- | --- |
| `.type` | 1058 | 115 | **54%** |
| `.clear` | 673 | 90 | 42% |
| `.within` | 153 | 41 | 19% |
| `.invoke` | 117 | 51 | 24% |
| `.scrollIntoView` | 109 | 41 | 19% |
| `.check` | 102 | 34 | 16% |
| `.select` | 94 | 36 | 17% |
| `.trigger` | 52 | 23 | 11% |
| `.selectFile` | 40 | 20 | 9% |
| `.uncheck` | 28 | 20 | 9% |

And three shapes measured separately:

```
cy.wait(<number>)      142  in 27 specs
cy.get('@alias')       242  in 37 specs
.then($el => { if ...   29  in 18 specs
```

**`.type` is in more than half the corpus.** The gap is not "B2 needs a select"; it is that
c8y-cygen cannot write the majority of the tests it exists to write. B2 is simply the first
oracle that says so.

## Proposal: one verb, and the compiler picks the call

Add **`fill`**, taking a target and an `IrValue`:

```json
{ "id": "choose-render-type",
  "fill": { "target": { "resolved": "...", "fromRow": "config#12" },
            "value": { "ref": "renderType" } } }
```

The compiler reads the **observed row** — which already carries `tag` and `attrs.type` — and
emits the right Cypress call:

| observed row | emitted |
| --- | --- |
| `<select>` | `.select(v)` |
| `<input type="checkbox">`, `<input type="radio">` | `.check()` / `.uncheck()` by the value |
| anything else that takes text | `.clear().type(v)` |

This is the ladder's move applied to interaction: **the model names the intent, the deterministic
half writes the code from what a probe observed.** It adds one verb rather than four, it cannot
emit `.select` at a text input, and it needs no new judgement from the model.

Two details the measurements settle:

- **Always `.clear()` before `.type()`.** 673 clears against 1058 types, so humans clear about
  two thirds of the time and the other third is typing into a field they know is empty. A
  generated spec cannot know that, and clearing is the deterministic choice.
- **`fill` is an action, so it inherits `click`'s rules**: cardinality of one, a target that is
  not `hidden` (finding 7), and the value must be an anchored `IrValue` — traceable to the
  contract, a capture or a value builder, exactly as a stub mutation must be. A typed literal
  that appears nowhere in the contract is the same fabrication rule, one verb over.

### What this proposal deliberately leaves out

- **`.trigger('change')`** — 52 uses. Cypress's own `.select()` fires `change`; the oracle's
  trigger is belt-and-braces around an AngularJS binding. Leave it out until an oracle fails
  without it, and let that failure make the argument.
- **`.scrollIntoView()`** — 109 uses, but `click` and `type` scroll the element into view by
  themselves. It earns its place only where an assertion needs visibility, which is `settle`.
- **`.selectFile`** — 40 uses in 9% of specs. A real gap, and no oracle needs it. Not now.
- **`cy.get('@alias')`** — 242 uses in 17% of specs, and B2's reference uses three. It is a
  convenience for a human writing by hand; a generated spec can repeat the resolved selector,
  which is both shorter to specify and easier to read at the failure. Recommend **never**
  building it, and recording that as a decision rather than an omission.
- **`.within`** — 19% of specs. The ladder already produces a scoped path, so `within` would be
  a second way to say the same thing. Ticket 12's probe uses it internally; the emitted spec
  does not need it.

## The two questions this ticket has to answer

### Q1 — the conditional interaction

B2's reference expands a panel only if it is collapsed:

```ts
cy.get('div.collapse').then($el => {
  if (!$el.hasClass('show')) { cy.get('[data-cy="c8y-li--collapse-btn"]').click(); }
});
```

The IR is declarative and has no `if`. Measured, the shape is rare — **29 uses in 18 of 213
specs (8%)** — so building branching into the IR to serve 8% is a bad trade on its face.

Three ways out, and the ticket has to pick one:

1. **The probe knows.** The flow reaches this point in a determined state; the probe observes
   whether the panel is open and the IR is authored for the state that was actually seen. Costs
   nothing, and breaks if the state is not in fact determined.
2. **An idempotent `reveal` verb** — click a target only if a second target is absent. That is
   a conditional by another name, with a narrow enough shape to be checkable.
3. **Refuse, and let the contract say it.** The scenario contract states the starting state as a
   precondition, and the spec asserts it rather than repairing it. Most faithful to *a test
   asserts, it does not fix* — and it makes B2's reference something the generated spec is
   deliberately **better** than.

Option 3 is the current recommendation, on the same reasoning that keeps `cy.wait(<number>)` out
(142 uses, 27 specs, and B2's own reference apologises for its one with an eslint-disable).

### Q2 — the prefix-ambiguous text

Already recorded by [Selector ladder](07-selector-strategy.md) as its one unresolved oracle
target: `cy.contains('c8y-datapoint-selector-list-item', 'e2eSeries')`, where `e2eSeries` is a
prefix of `e2eSeries2` on the same surface. `cy.contains` matches substrings, so the ladder
measures two matches and routes to assist — correctly.

The human resolves it with DOM order plus `.first()`, which ticket 07 called a latent flake. The
mechanical fix is an anchored regex, `cy.contains(sel, /^e2eSeries$/)`. Measured against house
style: of **1611** `contains()` calls in the corpus, **11 carry a regex** and 5 of those are
anchored. So the fix is correct and almost unprecedented — it would be right on axis A and
unusual on axis D.

B2 cannot be attempted without deciding this, because it is B2's central target.

## Order

1. `fill`, with the compiler picking the call from the observed row.
2. Q1 and Q2 decided — they are decisions, not code, and both are cheap once argued.
3. Run B2.

## What would falsify this

- **`fill` turns out to need the model to say which Cypress verb.** The whole proposal rests on
  the observed row being enough to choose. If a row exists where it is not — a custom component
  that looks like a div and behaves like a select — the verb splits into three and the argument
  for one verb goes with it.
- **Q1's option 3 makes B2 unwritable.** If the panel's state genuinely is not determined by the
  flow, "assert rather than repair" produces a flaky spec and option 2 wins.
- **B3 or B4 needs `.selectFile`, `.invoke` or `within`.** Each was left out on the grounds that
  no oracle needs it. That is a claim about five scenarios, not about the corpus, and the corpus
  says 9%, 24% and 19%.
