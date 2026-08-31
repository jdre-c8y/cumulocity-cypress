# Probe mode: the second compiler back-end

Type: prototype
Status: resolved
Blocked by: —

## Question

Ticket 03 settled that the agent emits a declarative IR and a compiler turns it into
house-style TypeScript. Ticket 02 settled that ground truth is harvested by a **probe
spec** compiled from *the same IR* through a second back-end — assertions become dumps,
unresolved selectors become collection points.

That back-end does not yet exist, and the IR as prototyped has no vocabulary for it.
Decide its shape by building it against the benchmark oracles.

- **How does an IR express "I don't know this yet"?** Somewhere between "visit this route
  and dump everything" and a fully-specified flow there must be a legal intermediate: a
  step that says *establish this state, then collect candidates here*. Is that a distinct
  placeholder step, a property on an existing step, or a separate `probe` section?
- **What exactly does a dump emit?** Ticket 07 owns the candidate table's schema; this
  ticket owns when rows are collected — after every step, only at marked points, or on
  demand — and what the network capture is scoped to.
- **How much can one probe run collect?** The economics inverted from v1: a run is
  expensive, but a dump *within* a run is nearly free. That argues for collecting
  aggressively rather than having the model ask for pieces. Where does that stop being
  true — page size, response volume, token cost of the resulting table?
- **Does probe mode reuse the spec back-end's setup emission verbatim?** It must, or the
  fidelity argument that motivated the whole decision leaks.
- **What does probe mode do with `stub`?** Ticket 02 permits a stub body derived by
  recorded mutation from an observed response — so the probe must record responses *before*
  any stub can be authored against them, which may mean a probe pass with stubs disabled.

The pre-registered tripwire from ticket 02 applies directly: **if a benchmark scenario
needs more than ~3 probe runs to reach a complete facts set, ticket 02's Q6 reopens.**
This ticket is where that gets measured, so it must count probe runs per scenario and
report the number.

Prototype against B0 (cheapest, single page) and B4 (plugin, no blessed setup library,
state-dependent labels) — the two ends of the range.

---

## Constraints from ticket 10 (loop shape)

- **The linter is the stop condition (`Q8(b)`).** Probe mode is not asked "have you
  gathered enough?" — the spec IR simply will not lint until every step's selector traces
  to an observed candidate-table row and every Expected Outcome maps to a row that could
  satisfy it. That places a requirement on this ticket: **probe mode must make "what is
  still missing" legible**, so a session can author the next probe IR from the gap rather
  than by guessing.
- **The budget is denominated in Cypress runs**, capped at **≤3 probe runs** and **≤6 runs
  total** per scenario. The ≤3 cap is ticket 02's pre-registered tripwire made
  operational, so this ticket must count and report probe runs per benchmark scenario —
  exceeding it reopens ticket 02's Q6.
- **Probe and spec compile from one IR and the model chooses the back-end per iteration**
  (`Q1(b)`). There is no phase transition to design; there is a compile-time flag and a
  prompt that has to make the choice obvious. A confused model compiling the wrong back-end
  wastes a run, which is the main prompt-level risk this ticket should probe for.

---

## Answer

Resolved by prototype plus three grilling rounds. Prototype: branch
`prototype/12-probe-mode`, commit `9a31ec8`, at
`.scratch/c8y-cygen-v2/prototypes/12-probe-mode/` — probe back-end, mode-aware linter,
patched spec compiler, both oracles, and the broken-file corpus.

### Result

```
B0.probe1   2 collect points, both scoped   ->  1 probe run
B4.probe1   4 collect points, all scoped    ->  1 probe run
            1 assert kept (structural wait), 1 dropped (value-bearing)
broken-file corpus                              8 caught / 8 cases
```

Both oracles fit in **one probe run** against a cap of three. **The tripwire does not
fire** — but the number is *structural, not measured*. See "Unvalidated" below.

### 1. The IR gains a `provisional` selector

The obvious design is a **hole** the model fills in later. It is wrong, and expensively so:
you cannot *run* a hole, so the probe must stop at the first one and spend a new run to
continue. B0 would need 2 runs; B4 would need 4, tripping ticket 02's wire on the plugin
oracle immediately.

What fixes it is that **the probe spec is thrown away and only its facts survive**, so
probe steps may use fragile structural selectors an emitted spec would never be allowed to
contain — `{ tag: button, matches: 'Change provider|Add global provider' }`. Marking them
`provisional` lets one run walk a flow the model cannot yet name.

> **Probe runs needed = the length of the *dependency chain* of unknowns, not the number of
> unknowns.** A second run is needed only when knowing selector X changes which *path* is
> taken — not merely which string is written.

**Resolution is additive** (`Q1(c)`): the provisional stays beside the selector it resolved
to. Rejected `(b)`, a separate probe document — safe, but it duplicates the reachability
description, which is the exact fidelity gap ticket 02 chose the one-IR design to close.
Keeping the guess costs one field and gives ticket 11 the record of *what the model was
reaching for* when a spec breaks later.

### 2. Resolution is deterministic, not a model judgement

**`Q8(b)` — the most valuable decision in this ticket.** The probe holds the element at the
moment it acts on it, so it records **which candidate row each provisional selector
matched**. Ticket 07's ladder then picks the selector mechanically. The emitted call becomes
`cy.c8yCygenProvisional({ id: 'enter-manager', ... }).click()` — a custom command that
resolves, records the match, and yields the element onward.

This inverts ticket 02's invariant from a **check** into a **construction**: the resolved
selector is *derived from* facts rather than *asserted against* them. A hallucinated
selector — the failure v1 hit twice and a human hand-patched — stops being detectable and
becomes impossible.

Rejected `(a)`, the model reading the table and choosing: it pays tokens to redo work the
probe already did, and can get it wrong.

**`Q9(b)` — ambiguity refuses rather than guesses.** `{ tag: button, text: 'OK' }` against
three OK buttons: Cypress `.contains()` silently takes the first. Under `Q8(b)` that
arbitrary choice would become a *committed selector*, the worst available outcome. So the
probe records the match **count**, and resolution refuses on a count above one, routing to
the assist path. This is a **fifth trip condition** for ticket 13, and a cheap one — a human
answers "which OK button?" in two seconds; a model burns four dollars guessing. Rejected
`(c)`, failing the run: it wastes a run to report what the facts file carries for free, and
under finding 10 it discards everything after the ambiguous step for nothing.

### 3. Two new verbs

**`collect`** (`Q5(a)`) marks where the probe looks. **Always scoped** — an unscoped
Cumulocity page yields a candidate table far larger than the flow needs, and an *automatic*
collect has no way to choose a scope, so it would be unscoped by construction. Both oracles
scoped 100% of their collects without effort. A debug-only `--collect-all` exists for the
case where the model needs one expensive wide look.

**`settle`** (`Q2(b)`) separates load-bearing waits from outcome checks, **declared, not
inferred**. The prototype's shape heuristic — keep asserts claiming only
existence/visibility on a resolved selector, drop the value-bearing ones — works on both
oracles but will misfire on the honest middle case: `assert: { get: x, count: 3 }` waiting
for a list to populate is load-bearing, and shape cannot tell. The precedent is ticket 02
splitting `cy.intercept` into three verbs for the same asymmetry: a dropped wait makes the
probe race and dump the wrong state; a kept value-assert fails the probe on the value it was
sent to discover.

**Waiting vocabulary** (`Q6(c)`): `settle` for DOM, `waitFor` for aliases, and `wait(ms)`
survives but must carry an explicit `because:` that the linter surfaces for review.
Measured: the corpus waits on an alias 810 times against 131 millisecond sleeps, and the
sleeps are the flaky ones. Banning sleeps outright backfires — a model denied one fakes it
by settling on something arbitrary, which is worse because it *looks* principled. Possible
but annotated keeps it visible in review and countable in the benchmark.

### 4. Probe mode is always integration-shaped

**`Q4(a)`.** Probe mode **strips derived stubs** — a probe honouring one is observing its
own fiction, and ticket 02 permits a stub body only from a blessed helper or by mutation of
an *observed* response — but **keeps blessed stubs**, which are often the only way to reach
the state at all (`createMockedDevice`, `mockFeatureAsEnabled`).

Consequence, stated plainly because it was implied by ticket 02 but never costed:
**B1, B2 and B3 produce tenant-free specs that cannot be generated tenant-free.** Three of
five benchmark oracles. Ticket 04's replay research could change this; nothing else will.

### 5. Facts envelope and cache granularity

**`Q7(c)`: one document per probe run, each entry individually cache-keyed.** Ticket 10 keyed
the cache by tenant URL, app version, and the IR prefix that established the precondition —
and a run has several collect points, each behind a *different* prefix, which simply *is*
the steps before it. Per-run keying is the expensive kind of wrong: change step 9 and you
discard facts for steps 1–8 that you already paid for and that did not change.

One document per run preserves what finding 10 below gives you.

### 6. Setup emission is shared, not reimplemented

The probe back-end imports the spec back-end's emitters. Confirmed by construction: B4's
three repo helpers (`disableCookieBanner`, `getAuth('admin').login()`,
`mockFeatureAsEnabled`) emit byte-identically in both modes. The fidelity argument that
motivated ticket 02's whole decision leaks the moment these diverge.

### Findings

**F5 — the spec back-end failed open on every probe-only construct.** Compiling a probe IR
through it produced `null.click();` for a provisional selector and
`/* UNKNOWN VERB collect */` for a collect. Neither is a compile error; both would have
shipped. This is the same class as ticket 03's silent coverage regression, which is why mode
is now a **linter rule with a regression case**, not a compiler assumption.

**F10 — a failed probe is not a wasted run.** Collects that already fired have already
written through the task channel, so a probe dying at step 9 still returns steps 1–8. This
materially lowers the risk of provisional selectors: a wrong guess costs *progress*, not the
run. It is also why `Q9(c)` and per-run cache keying are both wrong.

**F6–F9 — the IR could not express the baseline oracle.** Found by trying, not by
inspection. B0's oracle opens with `` `e2eDeviceToTestEvents${Cypress._.now()}` `` and then
wraps the **entire remainder of the test** in
`cy.getDeviceIdByName(name).then(deviceId => { ... })`. Ticket 03's IR has neither
capability. Four defects, all silent, all pre-existing:

| # | defect |
| --- | --- |
| F6 | No raw-expression vocabulary. The compiler emitted the literal text `'...${Cypress._.now()}...'` inside **single quotes** — not a template literal, so the spec navigates to a URL containing a literal dollar-brace. |
| F7 | No nesting scope. `captures` is not a step, it is a *scope change*; a flat step list cannot express it. |
| F8 | Interpolation must know which names are runtime identifiers in the emitted TypeScript and which are compile-time constants. Prototype 03 had only the second kind. |
| F9 | Helper-import collection assumed helpers are strings. B4 introduced the object form and the line kept mapping the object, emitting `import { [object Object] }`. |

All four are fixed in the prototype's `compile2.mjs`, and B0 now compiles to the oracle's
shape. They are **emission-target defects, not probe-mode ones** — ticket 03 prototyped
against B2 and B4, and neither needed a runtime value. The decision left inside them (may a
declarative IR hold raw TypeScript?) is raised as its own ticket rather than amended in
here.

### Unvalidated

**`Q10(a)`: the ≤3 probe cap is accepted as a named unvalidated assumption**, not measured.
The one-run result says all collect points lie on one linear flow, so one execution reaches
them all **if every provisional selector hits**. The real number is
`1 + (provisional misses)`.

A narrow measurement prototype was considered and rejected: it would measure a *hand-built*
probe's miss rate, and the miss rate depends almost entirely on how good the reachability
index is at seeding guesses — an index that does not exist yet. It would produce a number
that looks like evidence and is not. The tripwire belongs at first real contact, against the
real index.

Also not tested: no candidate table was produced (`cy.c8yCygenCollect` is a call site, not
an implementation — the row schema is ticket 07's), and table size is unmeasured, so the
scoping argument is reasoned rather than quantified.

### Note on ticket 03's convergence criterion

Ticket 03 passed its pre-registered check on *"oracle B4 needed 0 new verbs."* This ticket
adds two verbs. That is a **different axis** — capability growth, not scenario growth — so
it is not a falsification. But the IR's verb count is now growing for reasons that check was
not watching, and the next ticket that adds a verb should say so out loud.

### Facts later tickets depend on

1. Both oracles need **1 probe run** structurally; cap is 3. B0 has 2 collect points, B4 has
   4; all 6 are scoped.
2. The broken-file corpus catches **8/8**: probe-verb-in-spec, provisional-in-spec,
   outcome-satisfied-by-collect, two-verbs-one-step, unknown-verb, dangling-outcome-ref,
   unobserved-selector, unbound-runtime-reference.
3. B0's oracle is `[data-cy]`-rich: `c8y-events-list--timeline-item`,
   `c8y-event-details--source-wrapper`, `--time-wrapper`, `--type-wrapper`,
   `--creation-time-wrapper`. Its shape is `createDevice` -> `getDeviceIdByName().then()` ->
   everything nested.
4. The style profile emits `helperImport` for `createDevice` / `getDeviceIdByName`, which are
   globally-registered Cypress commands needing no import. A ticket 06 defect, left in the
   prototype deliberately.
5. `cy.c8yCygenCollect` and `cy.c8yCygenProvisional` are the two custom commands probe mode
   requires. Both are ours; neither touches `cumulocity-cypress`.
