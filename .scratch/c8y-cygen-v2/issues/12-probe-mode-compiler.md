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
