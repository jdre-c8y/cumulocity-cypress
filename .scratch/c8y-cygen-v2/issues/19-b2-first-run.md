# B2's first run: the probe never reached the widget configuration

Type: post-mortem
Status: open — four findings, none built
Blocked by: — (17 and 18 built; this is what running them measured)
Assignee: jdre

```
run b2-first   FAIL — no spec produced, so nothing to score on axes A or B
  cost               $4.6658 over 8 iterations, 5 Cypress runs (all probe), 8 model turns
  note               stopped on probe-runs
  note               TRIPWIRE: 5 probe runs against a cap of 5
  note               at least one start-to-start gap between Cypress runs exceeded five minutes
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
