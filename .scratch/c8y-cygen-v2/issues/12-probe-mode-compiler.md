# Probe mode: the second compiler back-end

Type: prototype
Status: open
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
