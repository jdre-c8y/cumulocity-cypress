# B2's first run: the probe never reached the widget configuration

Type: post-mortem
Status: findings 1 and 2 built (2026-09-15). `b2-second` re-ran against them and still FAILed on
the probe-run cap; its own facts caught finding 2's first version scoped to the wrong mechanism
(see finding 2's "Built" section) and it was corrected the same day. Finding 3 is a caution rather
than code and needs no change; finding 4 is a confirmation. A new, un-speced gap surfaced by
`b2-second` — the position rung has no ancestor-scoped form — is recorded, not built.
Blocked by: — (17 and 18 built; this is what running them measured)
Assignee: jdre

```
run b2-first    FAIL — no spec produced, so nothing to score on axes A or B
  cost               $4.6658 over 8 iterations, 5 Cypress runs (all probe), 8 model turns
  note               stopped on probe-runs
  note               TRIPWIRE: 5 probe runs against a cap of 5
  note               at least one start-to-start gap between Cypress runs exceeded five minutes
  stray files        0

run b2-second   FAIL — no spec produced, so nothing to score on axes A or B (findings 1+2 in place)
  cost               $6.9611 over 9 iterations, 5 Cypress runs (all probe), 9 model turns
  note               stopped on probe-runs
  note               TRIPWIRE: 5 probe runs against a cap of 5
  note               at least one start-to-start gap between Cypress runs exceeded five minutes
  died on            the same `.modal-content` guess as b2-first, one iteration later
  stray files        0
```

B2 is the hazard oracle, and this is the first time it has been attempted. It was unblocked by
[ticket 18](18-interaction-vocabulary.md) Q2 and [ticket 17](17-anchored-scope-and-observed-values.md)
finding 2, both built the same day and neither exercised by a measured run until this one.

**The flow never reached the widget's configuration**, which is where outcomes 3, 4, 5 and 6 all
live. Every probe run died at the same place.

| iteration | mode | died on | last surface collected |
| --- | --- | --- | --- |
| 1 | probe | `contains('Edit')` on a `<button>` | 4 surfaces, 911 rows |
| 2 | probe | `button[data-cy="c8y-dashboard-child--settings-edit"]` | 8 surfaces, 1709 rows |
| 3 | probe | `.modal-content` | `settings-dropdown` |
| 4 | — | 2 lint errors, no run spent | — |
| 5 | probe | `.modal-content` | `settings-dropdown` |
| 6 | probe | `.modal-content` | `after-edit-click` (missed) |
| 7 | — | 8 lint errors, budget exhausted | — |

The configuration modal **was open**. Probe 6's page-component inventory reports
`c8y-widget-config` present, count 1. The model guessed `.modal-content` three times and the
right name was in the facts the third time — on the run that had no successor.

---

## Finding 1 — `within: "body"` is a guaranteed miss, and it is what a lost model reaches for

`runtime.js`:

```js
$scope = within ? $body.find(within) : $body;
```

jQuery's `.find()` searches **descendants**, and `body` is not a descendant of itself. So
`within: "body"` matches nothing, always, on every page. The probe then reports

> `# after-edit-click  (within body)  NOTHING MATCHED THAT SCOPE, so no rows were collected.`

which is true of the code and false of the page, and reads as though the page were empty.

This is the move a model makes when it is lost — *collect everything and see what is there* —
and the domain notes tell it not to, for a good reason: a collect stops at 400 nodes, so a
page-wide one is truncated before it reaches what was being looked for. The notes are right and
the refusal is right. **What is wrong is that the refusal is silent and costs a whole probe
run.** `body` and `main` are not typos; they are a recognisable intent, and the probe should say
so by name instead of reporting a miss.

The inventory is the right recovery and it worked — it named `c8y-widget-config`. It arrived on
probe run 5 of 5.

**Decision to take:** refuse `body`/`main`/`html` as a scope *by name*, with the component
inventory, **without spending the run** — the collect is the first step of the surface, so the
probe can report the refusal and carry on rather than dying two steps later.

### Built

A semantic-linter rule, `lintIr.ts`: any `collect` step whose `within` is `body`, `html` or
`main` (case-insensitively) is refused before compiling, in every mode. Deliberately a lint
error rather than a runtime correction — nothing here silently rewrites what the model wrote, the
same way a provisional selector reaching the spec back-end is a lint rule and not a compiler
fallback.

`main` is grouped with `body` and `html` on a different argument than the other two: a page can
genuinely render one, so `.find('main')` is not a *structural* miss the way `.find('body')` is.
It is refused anyway, because naming it is the same "collect everything" move under a different
name, and a collect capped at 400 nodes on the whole page is truncated before it reaches what was
being looked for — the hazard the domain notes already warn against.

**What this decision does not do:** it does not hand back the component inventory itself, because
a lint rule runs before anything is observed and has no page to inventory. The message instead
names the two ways out — omit `within` for the same effect deliberately, or name a narrower
element — which is the information the model actually needs at that point, one iteration earlier
than the inventory would otherwise have arrived.

## Finding 2 — the anchored scope will anchor on live data

The rung built for B2 fired on B2, and its first real output was:

```
cy.contains('small', '13 Sept 2026 22:24:36')
  .parent()
  .find('[data-cy="c8y-datapoints-table--value-min"]')
```

Re-derived from the run's own facts, so this is measured and not inferred:

```
table-initial#111  {atLeast:1}  -> cy.contains('small', '13 Sept 2026 22:24:36').parent()
                                     .find('[data-cy="c8y-datapoints-table--value-min"]')
                                   [via data-cy+hop, observed 2]
```

The anchor is a **timestamp**. The probe walks the application unstubbed, so that text is live
tenant data; the spec runs stubbed against `widgets/dpt/measurement-series.json`, whose
timestamps are from 2024. The selector cannot match in the spec it is written for.

`[value]` is banned as a selector part because *it holds data, and data changes*. Rung 4 text is
data just as often, and nothing guards it. The hop makes it worse rather than introducing it: it
reaches for a text anchor where the ordinary search would have taken a position.

**Decision to take:** a text used as an **anchor** must be traceable to the scenario contract —
the rule the IR already applies to a typed value and to an asserted literal (`isAnchoredLiteral`).
`e2eSeries` is in the contract; `13 Sept 2026 22:24:36` is not. This needs the ladder to see the
contract, which is a signature change, and it is the reason to take it rather than a heuristic
about what a timestamp looks like — there is no honest test for *is this data*, and there is an
exact test for *did a human write this down*.

Note what this does **not** say: the plain text rung has the same exposure and has had it since
ticket 07. B1 and B0 passed with it. Widening the rule to every text leaf is a separate argument
and is not made here.

### Built, then found scoped wrong by the second run, then corrected (2026-09-15)

`ladder.ts` gained `isTraceable`, a predicate threaded through `resolveSelector`, `resolve` and
`resolveByHop`. The first version gated only ticket 18 Q2's anchored-regex pass, on the reasoning
that `resolveByHop`'s recursive call into `resolve` would inherit the same gate for free — "one
check, not two."

That reasoning was wrong, and a second run (`b2-second`) caught it rather than a unit test: B2's
timestamp needs no regex. `13 Sept 2026 22:24:36` was already unique among every row's own text
on that surface, so it resolved as an ordinary **plain** rung-4 leaf and never reached the
anchored-regex pass at all — the ladder still emitted
`cy.contains('small', '13 Sept 2026 22:24:36').parent().find('[data-cy="c8y-datapoints-table--value-min"]')`
with the first version of this rung in place. Confirmed by loading the run's own facts
(`probe-03/004-collect.json`) into `resolveSelector` directly, with the real contract text, rather
than trusting the model's report of what happened.

**Corrected scope:** the hazard is a text used as an **anchor** (ticket 17's role — a row the hop
reaches for), not a text that happened to need **anchoring** (ticket 18 Q2's regex mechanism).
Those are different axes, and the first version gated the wrong one. `resolveByHop`'s
`anchorExpression` now checks the resolved anchor's own leaf text directly — `textOf(hit)` — and
requires `isTraceable` on it regardless of whether that leaf is the plain or the anchored form.
The plain-leaf carve-out itself is unchanged: a text used as an ordinary leaf, never asked to
carry a hop, still has no traceability requirement, exactly as ticket 07 always allowed.

`lintIr.ts` is the one caller that verifies a real spec, and it supplies
`(text) => isAnchoredLiteral(text, contract)` — the exact rule a fabricated stub body and a fill's
typed value are already held to. Every other caller in this package is a unit test exercising a
rung with nothing to do with anchoring, so the parameter defaults to admitting everything.

Reproduced at unit-test size in `anchorTraceability.spec.ts`, in a new describe added after the
correction ("the gate catches a plain anchor too, not only an anchored-regex one"): two disjoint
timestamp-like texts, neither a prefix of the other, so the anchor resolves via the plain form —
and the gate now refuses it exactly when `isTraceable` does. Mutation-checked against the
*corrected* code: reverting to the leaf-only gate fails exactly this new test and nothing else.
Re-verified directly against `b2-second`'s own facts after the fix: `resolveSelector` now refuses
`datapoints-table#111` outright rather than emitting the timestamp anchor.

**What this still does not settle:** the refusal is not a working selector. Finding 3 predicted
the search would fall through to a position over the repeating `c8y-li-timeline` once the bad
anchor is removed; measured against `b2-second`'s facts, it does not, because the position rung
as built checks the *target's own direct-sibling count* (`repeat.siblingsLike`, 2 here — a
min/max pair inside one entry) rather than an *ancestor's* repeating group (the 20 `c8y-li-timeline`
entries the human's own selector, `cy.get('c8y-datapoints-table c8y-li-timeline').first()`,
positions over). Building that is a new capability - an ancestor-scoped position rung - that no
ticket has decided and this session was not asked to build. Recorded rather than built.

## Finding 3 — the position rung was the right answer and never got a turn

The oracle reaches the same value with `cy.get('c8y-datapoints-table c8y-li-timeline').first()`.
That is the repeating-list position rung, and the hop is ordered **before** it — deliberately,
on the argument that a hop is an identity the probe measured and a position is the order the
page happened to render in.

This target says the ordering is wrong when the anchor is a rung-4 text: a position over a
measured repeating list is a better selector than an anchor on a timestamp. Finding 2's rule
fixes this case as a side effect, by removing the bad anchor and letting the search fall
through. **If finding 2 is built, do not also reorder the rungs** — one change, and then measure
which targets still resolve badly.

## Finding 4 — the linter's anti-gaming guard fired for the first time, and correctly

Out of probe budget at iteration 7, the model wrote an IR that satisfied outcomes 3, 4, 5 and 6
with `click` steps:

```
outcomes[3]: satisfied by a 'click' step, which asserts nothing. Only an 'assert' or a
             'settle' puts a claim in the emitted spec - a dump is not an assertion, and
             neither is an action.
outcomes[3]: Expected Outcome 3 has no assertion: ...
```

Four outcomes, each refused twice. This is the guard [ticket 17](17-anchored-scope-and-observed-values.md)
finding 6 built and the note recorded as never having been exercised by a measured run. It has
now, and it did exactly its job: the run ended with **no spec** rather than with a green spec
that asserted nothing. A FAIL for the right reason is the outcome the guard exists to produce.

## What this run does not show

- **Nothing about axis A, B, C or D.** No spec was produced.
- **Nothing about whether Q2's anchored matcher works.** Its target is in the configuration, and
  the probe never got there. The one place the ladder emitted a regex on this run was inside
  finding 2's bad selector.
- **Nothing about cost at the ceiling.** $4.67 is comparable to B1's failing runs ($4.90, $5.37)
  and well inside the $20 gate. The cache-creation figure climbs every turn (14.9k -> 63.6k
  tokens) while cache reads stay pinned at 14,675 — only the static prefix is cached, and the
  facts document, at 3,085 rows by the end, is re-created each turn. The report's own
  five-minute-gap note fired. Worth watching on the next run; not a cost problem on this one.
