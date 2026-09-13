# Anchored scope, and the value no row carries

Type: prototype
Status: partly built — findings 1 and 3 landed in `2431213`; finding 2 open
Blocked by: — (07 resolved; reopened by the B1 oracle run)
Assignee: jdre

## Why this ticket exists

The map closed at sixteen resolved tickets with the note *"deciding complete."* B1 is the
first oracle to run end-to-end against a live tenant, and it came back **FAIL**. Axis B
passed 4 of 4 — the spec asserted every Expected Outcome for real, and gamed nothing. Axis A
failed on one assertion, and the run then hit the probe-run tripwire mid-heal.

```
VERDICT  FAIL
  A green            FAIL  1 test failure
  B outcome coverage PASS  4 of 4
  interventions      0
  cost               $4.8960 over 10 iterations, 7 Cypress runs (5 probe), 10 model turns
  note               TRIPWIRE: 5 probe runs against a cap of 5
```

This ticket exists because the failure is not a fluke and not a model mistake. **Three
separate mechanisms had to be missing for the run to end where it did**, and each is a
decision ticket 07 made, or did not make.

Everything below is measured. The run's facts survived at
`cumulocity-ui-e2e/.cygen/facts/b1-third/`, so each claim is checked against the DOM the
probe actually saw, and each corpus figure against the 214 hand-written specs in
`cumulocity-ui-e2e` and `c8y-ai-agents`.

## What failed

The blocking assertion, in two separate spec runs (iterations 6 and 9):

```
get [data-cy="c8y-dashboard-list--device-widget"]
assert expected '<span>' to contain text 'e2eDevice', but the text was ' Asset Properties '
```

The step behind it, as the final IR still carries it — this is outcome 4's. Outcome 3's step
carried the same resolved target in both failing runs; the last heal reverted it to a
provisional for a re-probe that the tripwire then refused to pay for.

```yaml
- id: assert-device-after-second-cycle
  assert:
    target:
      resolved: cy.get('[data-cy="c8y-dashboard-list--device-widget"]')
      fromRow: widget card on the group dashboard#13
    extract: text
    compare: includes
    operand: { ref: deviceName }
```

The row it names, from `probe-07/008-collect.json`:

```json
{ "i": 14, "parent": 10, "tag": "span",
  "attrs": { "data-cy": "c8y-dashboard-list--device-widget" },
  "classes": [], "text": "Asset Properties", "visibility": "visible" }
```

The element is the widget's **type label**. Its `data-cy` says *device-widget*; its text says
*Asset Properties*. The model chose it three times across two spec runs: for the assertion
immediately after the config dialog opened (iteration 6, failed at `steps[9]`), and again for
both post-save assertions (iteration 9, failed at `steps[13]`). Between the two it healed the
first one onto `[title="e2eDevice"]` and left the other two where they were.

## Finding 1 — the row summary hides a row's text as soon as it has a `data-cy`

`summariseFacts` builds one label per row, and the branches are exclusive:

```ts
const label = row.attrs.dataCy
  ? `data-cy=${row.attrs.dataCy}`
  : row.attrs.title
    ? `title=${row.attrs.title}`
    : row.text
      ? `"${row.text.slice(0, 40)}"`
      : "";
```

So the model was shown

```
widget card on the group dashboard#13  span  data-cy=c8y-dashboard-list--device-widget
```

and was never shown that the span reads *"Asset Properties"*. It picked the one row on the
surface whose **name** promised a device, against a summary that had withheld the one field
that would have refused it.

This is the defect that failed the run. It is a `data-cy` name-lure, and it is a fourth
variant for ticket 07 Part 2's hazard list — *a `data-cy` whose name describes the component
that owns the element rather than the content the element holds*. Unlike the other three it
needs no second state and no re-probe to catch: the contradicting evidence was already in the
facts, and the summary dropped it.

**Decision to take:** a row's label carries its identifying attribute **and** its text when
both exist. The summary is the largest text sent to a model and the cap is real, so the cost
was measured rather than assumed: across all 1,267 rows B1 collected, **91 (7.2%)** carry a
label *and* a text that the label currently hides. Restoring them costs **~1,060 characters,
about 266 tokens**, for the whole run. That is the entire price of the fix.

## Finding 2 — the ladder has no rung for an element identified by its neighbour

The hand-written B1 oracle reaches the asset-selector chip like this:

```ts
cy.get('[data-cy="Asset selection"]').parent().find('.chip, .tag')
```

The chip carries no `data-cy` and nothing else distinctive. It is identified by **what sits
next to it**, and no rung in ticket 07 can express that. The ladder's only compound form is
*ancestor-with-its-own-descriptor → leaf*.

### The corpus says this is a third of all specs

| shape | count |
| --- | --- |
| chains containing an upward verb | **238**, in **71 of 214 specs** (33%) |
| `.parents(SEL)` → `.find` / `.within` | 81 |
| `.parent()` → `.find` / `.click` / `.should` / `.contains` | 72 |
| `.closest(SEL)` → `.find` / `.within` / `.scrollIntoView` | 25 |
| `.siblings()` → … | 12 |
| `.parent().parent()` runs | 4 |

The four rows below the first are the common shapes, not a partition of the 238. Counted as
bare occurrences instead: **`.parent()` with no argument, 99**; **`.parents(SEL)` or
`.closest(SEL)` with one, 98**; `.siblings()` with none, 11. Two forms carry nearly all of it,
and the deep `.parent().parent()` walk that the ticket asked about — *when is it acceptable
versus a smell* — is **4 uses in 214 specs**. It is a smell. Do not build for it.

A check first, because ticket 07's rule is *if the ladder disagrees with the specs, the ladder
is wrong*: I also measured what humans use as the **scope** half of an ordinary compound
selector, to see whether `AncestorDescriptor`'s narrower vocabulary — `tag`, `dataCy`, `id`,
`classes`, `text`, and no `[name]`/`[title]`/`[role]` — is a second gap.

```
compound scopes measured: 609   custom-tag 432, tag.class 68, #id 9, other 100
scopes the ancestor vocabulary cannot express: 0
```

**Zero.** The ancestor vocabulary matches human practice exactly and must not be widened.
The gap is the *shape*, not the vocabulary.

### The rung

> **Anchored scope.** A scope part may be an ancestor the target shares with a named
> **anchor** row, where the anchor is any row that resolves on rung 1, 2 or 3.

Emitted in two forms, both taken from the corpus:

- `cy.get(<anchor>).parent().find(<leaf>)` — when the shared ancestor is the anchor's
  direct parent. No descriptor is needed, so nothing can be got wrong.
- `cy.get(<anchor>).closest(<descriptor>).find(<leaf>)` — when it is higher, and only if
  that ancestor carries a rung-1, -2 or -3 descriptor.

`.closest()` rather than the more common `.parents()`: `.parents()` can return several
elements and humans then patch it with `.first()`/`.last()`, while `.closest()` returns at
most one. The simpler verb, and deterministic.

**Refuse** when the shared ancestor is more than one hop up and its only descriptor is a class.
Rung 5 would offer `div.d-flex.p-r-16.fit-w.m-t-4.m-b-4` for B1's, and pinning a spec to a
layout utility class is a flake with a green tick on it. Coverage under this rule, measured
over the 197 **ancestor** hops (`.parent()`, `.parents(SEL)`, `.closest(SEL)`; `.siblings()`
excluded, see below): **155 expressible (79%), 42 refused** — and the 42 are exactly the
`.d-flex` / `.row` / `.card` / `.form-group` arguments.

`.siblings()` is **out of scope** and stays refused: 11 uses in 214 specs, and a sibling hop
is not an ancestor the two rows share, so it would need a second rule rather than a wider one.

The anchored scope counts as **one part**, so the three-part cap is unchanged.

### It solves B1's chip exactly, and costs no probe run

Computed against `probe-07/002-collect.json`:

```
chip:                            170  span.text-truncate[title="e2eDevice"]
anchor:                          138  button[data-cy="Asset selection"]
nearest shared ancestor:         103  div.d-flex.p-r-16.fit-w.m-t-4.m-b-4
                                      = the anchor's direct parent
emitted: cy.get('[data-cy="Asset selection"]').parent().find('span.tag.chip.text-12.tag--info')
human:   cy.get('[data-cy="Asset selection"]').parent().find('.chip, .tag')
```

The same hop, chosen mechanically.

The cost is the part worth arguing. **No new probe run, no browser change.** Rows already carry
their ancestor spines; the only thing missing is *identity* — two rows' spines are lists of
descriptors, and descriptors cannot be compared for sameness. Adding the node index to
`AncestorDescriptor` is a node-side change inside `rowsFromRawNodes`, where the raw `i`/`parent`
pairs are already in hand. Nothing new crosses the browser boundary.

This matters against ticket 02's falsification criterion, which reopens the Cypress-probe
decision above ~3 probe runs per scenario. B1 spent 5 against a cap of 5. A rung that needed
a second observation could not be afforded; this one needs none.

## Finding 3 — no row carries a value, so `extract: "value"` can never be anchored

The oracle's outcome-3 and outcome-4 checks read an input:

```ts
cy.get('ng-form[name="vm.ngForm"]').find('[title="Name"]').invoke('val').should('eq', 'e2eDevice');
```

The IR can say this. `Extractor` is `"text" | "attribute" | "value" | "count"` and the compiler
emits all four. But **nothing in the facts can ever justify it**: `RowAttrs` is documented as
*"the ladder's whole attribute vocabulary"* and has no field for a value, and `LADDER_ATTRS` in
the browser half does not read one. Searched across all four of B1's post-save surfaces, the
string `e2eDevice` appears in **zero of 293 rows**. The device name was on the screen; no fact
said so.

So the model had a correct assertion available, no evidence that it was available, and one row
whose name promised the device. It took the row.

The corpus says this is not a B1 quirk: **100 value-reading assertions** — 87 `have.value`,
13 `.invoke('val')` — across **36 of 214 specs** (16.8%).

### The distinction the ban blurred

`[value]` is banned as a **selector part** and must stay banned: it holds data, and data
changes. Ticket 07 then enforced that ban by giving the value no field to arrive in — and that
enforcement reached past *selection* into *observation*. The two are different questions:

- *May a selector be written against a value?* No, and the row schema should keep making that
  impossible.
- *May the model know an element holds a value?* It must, or a sixth of the corpus is
  unreachable.

**Decision to take:** the value becomes a field on `CandidateRow`, deliberately **not** inside
`RowAttrs`. Keeping `RowAttrs` as the ladder's complete vocabulary keeps the selector ban
structural rather than remembered, while the observation becomes visible to the summary and
citable by an `extract: "value"` assertion.

One implementation detail that is load-bearing: the browser half must read the **`.value`
property, not `getAttribute('value')`**. For a databound input the attribute holds the initial
server value or nothing at all, while the property holds what is on the screen. Reading the
attribute would produce a fact that is wrong in exactly the case the ticket exists for.

## Also found. None of it belongs to this ticket

- **The frozen-field guard fired for real, and it was right.** Iteration 8's heal was refused
  with 18 violations — the first time the guard has fired outside a unit test. Read back, the
  model had *deleted* `assert-device-after-widget-save` and `watch-child-assets`, re-added
  replacements under new ids, and remapped `outcomes.3.satisfiedBy[0]`. Every one of those is
  frozen, correctly. But editing that same step's `assert.target` **in place** is free, and
  nothing tells the model so: it burned a turn on a rename it never needed. →
  [Heal granularity](11-heal-granularity.md).

- **A probe takes one snapshot; a Cypress assertion retries.** One frame after the save the
  probe recorded `ng-form[name="vm.ngForm"]` as `hidden` with zero children — the widget's
  schema form had not rendered yet. The oracle's assertion waits it out. B1's outcome 3 needs a
  `settle` before the collect, and the domain notes never say that a surface which renders after
  a save must be settled before it is collected. → [Scenario authoring](08-scenario-authoring-assist.md).

- **The crash on B1's second run exited 0.** A CI would have read it as success. →
  [Hygiene](09-hygiene.md).

## Order, and the honest prediction

This corrects what the B1 post-mortem said first. The blocker was reported as the missing
parent/descendant path shape. It is not: **finding 1 is what failed the run**, finding 3 is
what makes the correct assertion expressible at all, and finding 2 — the one with the corpus
weight behind it — cost B1 nothing, because outcome 2 passed on a `[title="e2eDevice"]` that
happened to work.

1. ~~**Finding 1**, the summary label.~~ **Done** (`2431213`). Replayed through the run's own
   facts, the row that lured B1 now reads
   `span  data-cy=c8y-dashboard-list--device-widget  "Asset Properties"`.
2. ~~**Finding 3**, the observed value.~~ **Done** (`2431213`). The probe reads the `.value`
   property; the row carries it outside `RowAttrs`; the linter refuses an assertion on a value
   no probe observed, the way it already refuses an invented selector.
3. ~~The **settle** note in the domain notes.~~ **Done** (`2431213`) — and it is also the hint
   the new linter rule gives, so the model is told at the moment it needs it rather than only
   in the standing notes.
4. **Finding 2**, the anchored-scope rung. Open. The largest piece, the least B1 urgency, and
   the one a third of the corpus is waiting on.

### Two things the review of 1 and 3 found, which no test would have

- **A password would have reached the prompt.** Facts are written to disk and then sent to a
  model. A probe that walks a login form would have carried the tenant's credentials into both
  the facts file and the API payload. Refused in the browser half and again in node — the
  browser half is the layer a hand-written or replayed payload can bypass.
- **Clipping a value is a lie with a green tick on it.** The first cut clipped at the boundary
  and dropped at the final cap, so a clipped string could exist. Both stages now drop. An
  equality asserted against a prefix fails for a reason nothing in the facts explains.

Re-run B1 once after 1–3. Not before: a re-run without them fails identically, and B1 has
already spent $7.81 against the benchmark's $10-per-oracle gate.

## What would falsify this

- **B1 still fails after 1–3.** Now testable: 1–3 are built. Then the diagnosis is wrong, and a
  second re-run is not worth buying. Stop and re-read the facts rather than iterate.
- **Finding 2's rung changes any of ticket 07's six exact oracle matches** when replayed
  through that ticket's prototype (branch `prototype/07-selector-ladder`, `732afd0`; the
  working tree no longer carries it). The rung is additive by
  construction — it only offers paths where none existed — so if a previously exact match
  moves, the scoring is wrong, not the rung.
- **The anchored scope needs a second observation after all.** The whole cost argument rests on
  the shared ancestor being computable from spines the probe already wrote. If it is not, the
  rung has to be re-argued against ticket 02's ~3-probe-run criterion, which B1 already breached.
