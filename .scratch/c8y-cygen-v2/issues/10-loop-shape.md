# Loop shape: one agent session, or separated phases?

Type: grilling
Status: open
Blocked by: 02

## Question

Graduated from fog once [Emission target](03-emission-target.md) settled on (c) — an IR
compiled to TypeScript. That answer makes the phase boundaries concrete enough to argue
about, because the pipeline now has named artifacts between stages rather than one
undifferentiated conversation.

v1 ran explore + write + run + retry as a single agent session with one accumulating
context. Cost scaled with interaction count, a fixed 50-turn budget was silently
exhausted three times, and every retry re-derived the whole spec's context.

With (c), the stages have real boundaries and real artifacts:

```
scenario contract → [gather ground truth] → facts
facts + contract   → [emit IR]            → IR  (schema + linter validate here, no tenant)
IR                 → [compile]            → TypeScript spec  (deterministic, no model)
spec               → [run Cypress]        → pass | diagnostic + screenshot
diagnostic         → [patch IR]           → IR' → recompile
```

Resolve:

1. **Where do the session boundaries fall?** One session throughout; or a session per
   stage with only the named artifact crossing between them; or something between.
2. **Which stages need a model at all?** `compile` needs none — it is deterministic. Does
   `gather` need the same model as `emit`? Gathering is high-volume, low-judgement
   (navigate, snapshot, harvest selectors); emitting is one well-informed pass. That
   asymmetry is the strongest argument for splitting, and it is also a cost lever.
3. **What crosses a boundary?** If a fresh session emits the IR, the facts must be
   *written down* — which means a fact format, not just conversation history. What is in
   it? Harvested selectors, observed network traffic, rendered-branch observations?
4. **What does a boundary cost?** Separate sessions cannot share a prompt cache, so
   splitting trades cache reuse for smaller contexts. v1's cache-creation spikes suggest
   its single long session was already losing cache benefit — but that is a reasoned
   hypothesis, never empirically re-validated.
5. **Where does the structured human-assist path attach?** Charting settled that assist is
   a first-class outcome, not a failure. Which boundary does a human interrupt at?

Note the interaction with [Can iterations replay against recorded traffic?](04-replay-and-determinism.md):
if replay works, the `run Cypress` stage stops needing a tenant, which changes what a
boundary costs. Take that answer into account if it has landed.
