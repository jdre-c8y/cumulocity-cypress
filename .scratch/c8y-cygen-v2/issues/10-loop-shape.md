# Loop shape: one agent session, or separated phases?

Type: grilling
Status: resolved
Blocked by: — (02 resolved)

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

---

## Constraints from ticket 02 (ground truth)

Ticket 02 fixed several of this ticket's inputs:

- **Probe and spec are one IR, two compiler back-ends.** Probe mode dumps where spec mode
  asserts. So a "gather ground truth" phase is not a different program — it is the same
  program, less finished. This shrinks the space of plausible loop shapes considerably.
- **A probe turn is a whole Cypress run**, not a millisecond CDP call. Sequential probes
  are the dominant latency term, and ticket 02 pre-registered a tripwire: **more than ~3
  probe runs to reach a complete facts set on any benchmark scenario reopens the
  Cypress-probe decision.** This ticket's loop shape is what determines whether that
  tripwire fires.
- **Facts are an ephemeral, cached build artifact** keyed by (route, precondition),
  gitignored. **Open question this ticket inherits: what invalidates a cache entry?** A
  new tenant, a redeployed app, a changed precondition, elapsed time — and whether a stale
  entry is detectable at all without re-probing.
- **Healing needs a reachable tenant** under the ephemeral-facts decision, unless ticket
  04's replay research says otherwise. The "what does a session boundary cost" question in
  this ticket therefore depends on ticket 04, which is still unfired.

---

## Answer

Resolved by grilling, two rounds. The ticket asked "one session or separated phases?" and
the answer is neither: **one loop, one artifact, one kind of turn**, with a fresh stateless
session per iteration.

### The loop

```
contract + conventions index
  → [author or refine the IR]     ← the only model stage; fresh session each time
  → [compile: probe or spec]      ← deterministic, no model
  → [run Cypress]                 ← no model; the only metered operation
  → facts | pass | diagnostic
  → back to refine
```

**`Q1(b)`.** Ticket 02 made probe and spec one IR with two back-ends and removed
interactive browsing entirely — the model never drives a browser turn by turn. So
"gather ground truth" is not a phase. It is an early iteration that compiled in probe mode
because the IR did not yet lint. The choice of back-end *is* the phase, and it is a
property of one turn rather than a stage transition.

The property that makes every other question in this ticket easy: **there is no state to
carry across a boundary, because the IR is the state and it is on disk.**

Rejected: distinct phases with distinct prompts (`(a)`) and a two-phase acquire /
author-and-heal split (`(c)`). Both invent transitions the artifacts do not need. The live
risk with `(b)` is a confused model compiling the wrong back-end and burning a run; that is
a prompt problem, and the compiled artifact makes the mistake visible immediately.

### The linter is the stop condition

**`Q8(b)`.** Something has to tell the model to stop probing and start asserting. Nothing
does — because it cannot start asserting. Ticket 02's invariant says no selector may enter
the IR unless a probe observed it, so an under-probed spec IR is **unlinttable by
construction**. "Am I done gathering?" is therefore a free local check, not a judgement
call, and a wasted Cypress run from premature asserting should be near-impossible.

This is the strongest consequence of the decisions already made, and it is the direct
answer to v1's failure mode of asserting confidently against an imagined selector.

Completeness means: every step's selector traces to an observed candidate-table row, and
every Expected Outcome maps to at least one row that could satisfy it.

### Sessions are stateless; the attempt log is what makes that safe

**`Q3(b)`.** Each iteration is a fresh session reading artifacts from disk. v1 accumulated
— `driveSelfHealLoop` chains message history across attempts and `moveMessageCacheBreakpoint`
slides the breakpoint forward — and burned $4.22 and $2.42 on runs that produced nothing.
After a failed Cypress run, most accumulated reasoning is the reasoning that produced the
failure.

**`Q7(b)` — what crosses a boundary:** the contract, the conventions index, the current
IR, the facts, the last diagnostic with screenshots, and an **append-only attempt log**.

The log is load-bearing, not bookkeeping. Without it, fresh sessions oscillate — flip a
selector, fail, flip it back, fail — and the budget burns on a two-state loop no single
session can see. It records, per iteration: what changed, which run it produced, how that
run failed, what was concluded. It pays for itself three times over: it prevents
oscillation, it *is* the packet the human-assist path presents, and it makes a run
auditable after the fact.

Rejected: full prior transcripts (`Q7(c)`) — that reintroduces the accumulating context
`Q3(b)` exists to escape, in its worst form, as verbatim wrong reasoning.

### Correction to this ticket's own premise

The ticket asserted that *"separate sessions cannot share a prompt cache."* **That is
wrong.** Anthropic prompt caching keys on the request prefix, not on a session. Two
separate invocations with a byte-identical system prompt, tool set and cached prefix both
hit the cache, subject to TTL.

A session boundary therefore costs only the accumulated conversation, never the expensive
static preamble — house rules (read live from the target repo's
`.claude/rules/e2e-tests.instructions.md`), domain notes, and the conventions index. This
is most of why `Q3(b)` is affordable, and it demotes v1's never-validated 1-hour-TTL fix:
the expensive prefix caches either way.

### Budget: denominated in Cypress runs

**`Q2(b)`.** v1 counted tool-call turns (`DEFAULT_MAX_ITERATIONS = 100`,
`DEFAULT_MAX_SELF_HEAL_ATTEMPTS = 3`) because six of its ten tools were sub-second browser
calls. Under ticket 02 those six are gone. The Cypress run is now the only expensive,
irreversible, tenant-touching operation, so it is the unit.

**Defaults, pinned so benchmark results are reproducible:**

| cap | value | rationale |
| --- | --- | --- |
| probe runs | **≤ 3** | matches ticket 02's pre-registered tripwire, so exceeding it *trips* rather than silently passing |
| total runs | **≤ 6** | fits `Q9(c)`'s expected shape with one spare |

This fixes v1's worst diagnostic failure — a 50-turn budget silently exhausted three times
with no signal separating productive work from a stuck loop. Progress is now legible:
"run 3 of 6, four of five Expected Outcomes covered."

Dollars are reported alongside but do not enforce: the same figure means different things
at different context sizes, so it is a bad control variable even though it is the thing
actually cared about.

### On failure: patch first, re-probe second

**`Q9(c)`.** A first failure is usually cheap-class — a timing wait, an off-by-one, a
selector that exists but was mis-scoped — and the screenshot plus the source-mapped IR step
is enough. A **second** failure on the same step means the model's picture of the app is
wrong, and re-reading the same diagnostic cannot fix that; only fresh observation can.

Expected shape against the 6-run cap: `probe → spec fails → patch fails → re-probe →
spec passes` = five runs, one spare.

Rejected: always re-probing (`(b)`) halves the attempt budget to buy information usually
not needed. Always patching (`(a)`) is v1's "self-heal without any way to see a failure was
mostly guessing".

### One model, for now

**`Q6(a)`.** v1 used `claude-sonnet-5` throughout. Tiering (cheap for probe authoring,
strong for assertion authoring and healing) has a good argument and is trivially
implementable under `Q3(b)` — but **the benchmark has never been run against anything**.
With no baseline, a model-tier variable makes the first numbers unable to distinguish "the
architecture works" from "the tier was wrong".

Specific trap noted: cost here is model tokens, and a weaker model that causes one extra
iteration adds a whole large-context call *and* a Cypress run. Tiering only wins if it does
not add iterations, and there is currently no way to know. Revisit after the first
benchmark run.

### Human-assist attaches at named trip conditions

**`Q4(b)`.** Not at budget exhaustion — charting settled that asking early beats burning $4
guessing, and waiting for exhaustion *is* burning $4 first. Assist fires the moment the
system knows it cannot proceed correctly, rather than merely failing:

1. **No blessed setup move exists** for a required precondition (ticket 02).
2. **A required selector is absent** from every candidate table (ticket 02's invariant).
3. **An Expected Outcome cannot be mapped** to a concrete assertion (ticket 01's guardrail).
4. **Budget exhausted** (`Q2`).

Each is already mechanically detectable from decisions made, so this costs no new
machinery. Rejected: assist after every Cypress failure (`(c)`) turns the tool into a
pair-programming session, contradicting unattended green as the goal.

### Facts-cache invalidation

**`Q5(b)`**, inherited from ticket 02. The key carries: tenant URL, the app/plugin version
from `getShellVersion` / `getSystemVersion`, and **the IR prefix that established the
precondition** — plus a TTL backstop.

Keying on the establishing IR prefix rather than a prose precondition label is the point:
it is the only form of the key that cannot drift from what actually ran. A redeploy is the
likeliest silent invalidator, and the library already exposes the version commands to
detect it cheaply.

Rejected: never reusing across runs (`(c)`) throws away the reuse that makes healing
affordable — under `Q3(b)` the cache is the only thing carrying knowledge across
iterations.

### Facts later tickets depend on

1. **v1 explicitly forbade probe specs** — the mechanism ticket 02 adopted. From
   `src/prompt/promptAssembly.ts`: *"Do not write throwaway 'probe'/'dump' specs … each
   such run costs a full Cypress/Electron process and real tenant writes."* The agent
   invented the pattern unprompted and was told to stop. The hack part (leaking values
   through a deliberately-failing assertion's error diff) is gone in v2; the cost objection
   is not, and is exactly what the ≤3 probe cap bounds.
2. **Six of v1's ten tools evaporate.** Gone: `browser_navigate`, `browser_snapshot`,
   `browser_click`, `browser_type`, `list_data_cy`, `capture_network`. Surviving:
   `run_cypress`, `read_file`, `stage_fixture`; `write_spec` becomes "emit IR".
3. v1 defaults: `DEFAULT_MODEL = "claude-sonnet-5"`, `DEFAULT_MAX_ITERATIONS = 100`,
   `DEFAULT_MAX_SELF_HEAL_ATTEMPTS = 3`, `MAX_ERROR_MESSAGE_CHARS = 3000`,
   `MAX_SCREENSHOTS_PER_RETRY = 2`.
4. `CypressRunResult` shape as built in v1:
   `{ pass, testFailures: [{ title[], errorMessage, screenshotPath? }], specFailures }`.
   Ticket 03's source map adds the missing field: **which IR step**.
5. The target repo's house rules are a real, maintained artifact:
   `cumulocity-ui`'s `.claude/rules/e2e-tests.instructions.md`, symlinked into
   `.github/instructions/`. v1 read it live every run rather than vendoring it, so it could
   never drift. Keep that.
6. Prompt caching is prefix-keyed, not session-keyed.
