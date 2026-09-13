# The interaction vocabulary: c8y-cygen cannot fill in a form

Type: grilling
Status: **decided; `fill` and Q2's rung built.** Q1 is option 3 and needs no code. Q2's anchored
matcher is built — **as a leaf move only**, because reading Cypress's own matcher showed the
decided form cannot reach the target the decision named. B2 has not been run: it is blocked on
[ticket 17](17-anchored-scope-and-observed-values.md) finding 2, the anchored scope.
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

## As built

`fill` takes a target and an `IrValue`, and `chooseFillCall` reads the Cypress call off the
observed row. One addition to the proposal, and it is the one thing measurement could not have
told us — it came out of asking what each verb does when it lands on the wrong element:

> **A fill's target may never be `provisional`.** A click on the wrong element usually errors, so
> a wrong guess costs the probe run it was always risking. A fill on the wrong input *succeeds*.
> The value goes somewhere, the form looks filled in, and every surface collected after it
> describes a state the scenario never asked for.

So a fill is refused in **both** modes until a probe has collected the form and the IR cites the
control's row. That costs one extra probe run on a flow whose form is the last thing the probe
reaches. It is the cheaper of the two mistakes, and it is the claim most likely to be wrong —
see *What would falsify this*.

Everything else is as proposed: always `.clear()` before `.type()`; a checkbox or radio takes a
literal `true`/`false` (a `ref` would pick `.check()` or `.uncheck()` regardless of what it
holds, which is the IR saying something it does not mean); the value is anchored to the contract;
`fill.value` is frozen on a heal turn, because re-pointing a fill is a targeting fix and
re-typing one is changing the scenario. A file input, and a `<div>` wearing a select's clothes,
are both refused by name rather than defaulted.

The facts summary now marks an input's `type=`. Without it the model cannot tell a checkbox from
a text field, and the difference decides both the call and the shape of the value.

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

**Decided: option 3.** A test asserts; it does not repair. The contract states the starting state
as a precondition and the spec asserts it, which makes the generated spec deliberately *better*
than B2's reference on this line rather than merely different.

Three things carry the decision:

- The shape is rare — 29 uses in 18 of 213 specs, 8%. Branching in the IR is a large, permanent
  capability bought for one eighth of the corpus.
- It is the same reasoning that keeps `cy.wait(<number>)` out: 142 uses across 27 specs, and
  B2's own reference apologises for its one with an eslint-disable. Frequency in the corpus is
  evidence about what humans do under time pressure, not about what the tool should write.
- Option 1 is not actually different from option 3 in the passing case, and is worse in the
  failing one. Both author for the state the probe saw; option 3 additionally *says so*, so when
  the state is not what the contract claimed the spec fails at the assertion instead of silently
  taking the other branch.

What this costs is written down under *What would falsify this*: if the panel's state genuinely
is not determined by the flow, this produces a flaky spec and option 2 wins.

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

**Decided: the anchored matcher.** `cy.contains(sel, /^e2eSeries$/)`.

Right on axis A beats familiar on axis D, and the alternative is not "familiar" so much as
"flaky": `.first()` resolves the ambiguity by DOM order, which is a property of the render and
not of the test. Ticket 07 already called it a latent flake when a human wrote it; the tool
writing it deliberately would be worse, because the tool is the half that is supposed to know.

Two conditions on the decision, so it does not become a licence:

- The anchored matcher is the **ladder's** move, not the model's. It belongs where a measured
  ambiguity forces it, and nowhere else — 11 regexes in 1611 `contains()` calls is the house
  style, and a tool that reached for one by preference would be writing a dialect.
- The axis-D grader is told it is a deliberate deviation, with this ticket as the reason. An
  unexplained deviation and a justified one score the same only if the grader is told which is
  which.

#### As built — and the decision was wrong in one respect

The rung is in `resolveSelector` as a **second pass**: every plain path has to fail first,
however long, so a two-part plain scope beats a one-part regex. That is what keeps 11-in-1611 the
house style rather than a dialect. Where it fires, it beats the `position` rung, which is the
whole point — `.first()` resolves an ambiguity by DOM order, and DOM order is a property of the
render rather than of the test.

Three corrections, all from reading Cypress's own matcher
(`cypress_runner.js`, `cy-contains-regex`) rather than from a run:

```js
const normalizeWhitespaces = elem => {
  let testText = elem.textContent || elem.innerText || $(elem).text();
  if (elem.tagName === 'PRE') return testText;
  return testText.replace(whitespaces, ' ');          // collapsed, NOT trimmed
};
return function (elem) { return regex.test(normalizeWhitespaces(elem)); };
```

1. **Cypress tests the regex against the element's whole subtree text; a candidate row records
   the element's *own* text.** On a leaf those are the same string. On a wrapper they are
   nothing like each other — so `cy.contains('c8y-datapoint-selector-list-item', /^e2eSeries$/)`
   matches **zero** elements, because a list item holding a label, a select and its option text
   never reads exactly `e2eSeries`. The decision named that line as the target, and the decided
   form cannot reach it. The plain string works for a human precisely because a substring test
   tolerates the gap; anchoring removes the tolerance that was carrying it.

   So the rung anchors a **leaf and never a scope**, and the refusal on that scope stands exactly
   where ticket 07 left it.

2. **Whitespace.** Cypress collapses runs of whitespace but does not trim; `ownTextOf` trims. So
   the emitted matcher is `/^\s*text\s*$/`, not `/^text$/`. Without the slack a span written
   over three lines matches nothing — and it fails as a timeout, not as a count the ladder could
   have refused.

3. **Truncation.** A row's text is cut at 80 characters, and a cut text is a prefix of the real
   one — the one thing an anchored matcher cannot survive. A text at the cap is never anchored.

Two of these are the same mistake in different clothes: an anchored matcher asserts that the
recorded text is *the whole of* what the element holds, and the facts only ever promised that it
was *part of* it. The plain form never made that assertion, which is why it never noticed.

#### What this costs B2

B2's central line — `cy.contains(item, seriesName).find('select[formcontrolname="renderType"]')`
— is a **scope**, so Q2 does not unblock it. It needs
[ticket 17](17-anchored-scope-and-observed-values.md) finding 2, the anchored scope: reach the
element that carries the text, then walk out to the component that holds it
(`.closest(SEL).find(…)`), with Q2 doing the leaf half of the work. That finding was already
open, already argued and already sized; it is now B2's blocker rather than B4's dependency.

Q2 still earns its place in B2 at the leaf: outcome 5 asserts the one remaining series column
label, `c8y_TemperatureMeasurement → e2eSeries °C` against
`c8y_TemperatureMeasurement → e2eSeries2 °C` on the same surface — a prefix pair on two leaf
spans, which is exactly the shape the rung resolves.

## Order

1. ~~`fill`, with the compiler picking the call from the observed row.~~ Built.
2. ~~Q1 and Q2 decided.~~ Option 3, and the anchored matcher.
3. ~~B2 — which carries Q2's ladder rung with it.~~ The rung is built, and building it against
   the one target that needs it is what showed the target was out of its reach. See *As built*.
4. [Ticket 17](17-anchored-scope-and-observed-values.md) finding 2, the anchored scope — now
   B2's blocker rather than B4's dependency.
5. B2.

## What would falsify this

- **`fill` turns out to need the model to say which Cypress verb.** The whole proposal rests on
  the observed row being enough to choose. If a row exists where it is not — a custom component
  that looks like a div and behaves like a select — the verb splits into three and the argument
  for one verb goes with it. The fixture carries that div on purpose; today it is refused by
  name, which is a diagnostic rather than an answer.

- **Refusing a provisional fill costs a probe run that matters.** The claim is that a form is
  something you collect before you touch, so the extra run is one the flow needed anyway. If B2
  or a later oracle spends a whole run only because a fill could not guess, the answer is a
  runtime dispatch in the probe back-end — the throwaway spec resolves the element and picks the
  call in the browser — and the refusal narrows to spec mode.
- **Q1's option 3 makes B2 unwritable.** If the panel's state genuinely is not determined by the
  flow, "assert rather than repair" produces a flaky spec and option 2 wins.
- **The anchored matcher never fires.** It is a leaf move over a measured prefix pair. B2's
  outcome 5 is one, and if no oracle produces another, the rung is dead weight bought for one
  assertion — and `.first()`, for all that it is a latent flake, would have cost nothing.
- **B3 or B4 needs `.selectFile`, `.invoke` or `within`.** Each was left out on the grounds that
  no oracle needs it. That is a claim about five scenarios, not about the corpus, and the corpus
  says 9%, 24% and 19%.
