# Hygiene: output location, abandoned attempts, and tenant-data teardown

Type: grilling
Status: resolved
Blocked by: —

## Question

Short ticket, real decisions. These are only bugs if a second person uses the tool — and
the audience is team adoption, so they are adoption blockers on the route, not polish.

Three v1 gaps, each observed:

1. **No canonical output location and no cleanup of abandoned attempts.** Repeated runs
   against one scenario left **three separate spec files with the same test title** in
   the target app repo, one of them a literal `it('debug', ...)` leftover probe. Decide:
   where does a generated spec land (derived from the conventions file of ticket 06?),
   what happens on a re-run against the same scenario — overwrite, version, refuse? —
   and how are failed attempts cleaned up rather than abandoned in place?
2. **Orphaned tenant data from the exploration phase.** The generated spec's own
   setup/teardown discipline was solid; the *exploration* phase's real, tenant-touching
   actions had no equivalent, leaving stray groups and dashboards behind. Decide the
   teardown contract for exploration. Note the asymmetry: exploration is exploratory, so
   it cannot always know in advance what it will create — does it need a transaction log
   of created entities, a tagging convention, or a scoped throwaway area?
3. **Debug/probe artifacts.** The `it('debug')` leftover was not a generation-logic bug
   but a lifecycle gap. Should probe activity be structurally incapable of reaching the
   target repo — e.g. written only to a scratch area until it passes the guardrail?

Also settle: does a generation run touch the target repo's git state at all (branch,
commit, leave dirty), or only write files and let the human handle version control?

---

## Added by tickets 02 and 10

Two new artifacts now need a location and lifetime policy, beyond the emitted spec:

- **The facts cache** (ticket 02, `Q16(a)`): ephemeral, gitignored, keyed by tenant URL,
  app/plugin version, and the establishing IR prefix, with a TTL backstop. Where it lives,
  whether it is shared between developers, and when it is swept.
- **The attempt log** (ticket 10, `Q7(b)`): append-only, one entry per iteration, written
  by stateless sessions. It is also the audit trail and the human-assist packet, so it
  probably outlives a run even though the facts do not.

Also inherited from ticket 02's `Q7(c)`: the generated spec resets **only state it created
itself**, per `it()`. Tenant-data teardown is therefore bounded to the blessed setup
vocabulary rather than being an open-ended cleanup problem — but abandoned runs that failed
partway can still leave that footprint behind, which is this ticket's problem.

---

## Facts envelope, from ticket 12

[Probe mode](12-probe-mode-compiler.md) settled the shape of the facts artifact this ticket
must find a home for:

- **One document per probe run, with each collect entry individually cache-keyed.** Per-run
  keying discards facts for steps 1–8 when step 9 changes — facts already paid for that did
  not change. The key per entry is ticket 10's (tenant URL, app version, establishing IR
  prefix), where the prefix simply *is* the steps preceding that collect.
- **A probe that dies partway still returns everything collected before the failure**, so
  the document must be valid when incomplete. Whatever sweeps these files cannot assume a
  well-formed, finished run.
- **Probe specs are throwaway and must never be committed.** They are compiled, run, and
  discarded; only facts survive. Where they are written matters — a stray probe spec left in
  a target repo's `cypress/e2e/` would be picked up by that repo's own test run.

---

## Answer

**One working area, one deterministic output path, and a footprint that is known before
the run starts.** Three gaps, and none of them turned out to be the gap the ticket
described.

### The measurements that reframed the ticket

Taken before any decision, because three of them overturn the ticket's own premises:

| Measurement | Value | Consequence |
| --- | --- | --- |
| e2e `specPattern` | **unset in both repos** (the one at `cumulocity-ui-e2e/cypress.config.ts:89` is inside the `component` block) | Cypress's default applies, so **any** `.cy.ts` under `cypress/e2e/` runs in that repo's own suite. The `it('debug')` fear is exact, not anecdotal. |
| Relative imports in specs | **64 of 200** host specs, to depths of `'../../../support/helpers/…'` | A spec's path is baked into its imports. It cannot be compiled in a staging area and moved. |
| Spec-tree organisation | host **by team** (`appEnablementTeam`, `dataAndControlTeam`, `platformTeam`); plugin **by capability** (`contracts`, `llm`, `no-llm`) | No rule derives a directory from a scenario. The conventions file cannot answer this; a human must. |
| Test-data naming | `e2eDevice` ×40, `e2eUser` ×22, `e2eWidgetDashboard` ×20, `e2eDashboard` ×19, `e2eDeviceGroup` ×15, in **both** repos | A sweep key already exists as house convention. |
| …but uniqueness | only **5** `Date.now()` and **9** `Math.random` across 200 specs | The names are fixed literals. Re-runnability rests entirely on teardown, so a crashed run collides with the next one. |
| Teardown discipline | **30 of 200** host specs have `after`/`afterEach`; **8 of 11** plugin specs do | The plugin repo is disciplined; the host repo is not. |
| Deletes | **70 of 200** host specs issue a DELETE; dominant target `/inventory/managedObjects/${groupId}` (18) | Groups *and* dashboards — both entity types observed left behind — are managed objects, and die at one endpoint. |
| Teardown transport | host `cy.request` ×24; plugin `c8yclientf` ×15, **all of them teardown** | Per-repo conventions fact, exactly as ticket 15 predicted. |
| Cypress assets | both repos: `trashAssetsBeforeRuns: true`, `video: true`, `screenshotsFolder: cypress/snapshots/actual` — beside **38 committed visual-regression baselines** in the host | A v2 run writes into the visual-regression comparison folder and destroys the developer's own prior artifacts. |
| Tenants | `jdre.preprod.c8y.io` and `tristan.preprod.c8y.io` | The two repos point at *different personal* tenants. Facts keyed by tenant URL are inherently per-developer. |

### 1. The working area: one `.cygen/` in the target repo

`Q1`, `Q7`, `Q16`. Everything uncommitted lives in **one gitignored `.cygen/` at the target
repo root**. It has to be inside the repo, because a probe spec must be bundled by the
target repo's own Cypress project; putting the rest elsewhere would buy nothing and give
two places to sweep. Neither repo has a scratch path to reuse — the host gitignores
`.tmp/`, the plugin nothing suitable — so `.cygen/` needs a `.gitignore` line, and §5 says
who writes it.

```
.cygen/
├── lock                     # runId + pid; one run at a time per repo
├── facts/                   # per-entry cache-keyed; TTL backstop; never shared
├── probe/                   # throwaway probe specs; deleted at end of run
└── runs/<runId>/
    ├── ir.yaml              # ephemeral (§6)
    ├── attempts.jsonl       # append-only; kept
    ├── manifest.json        # tenant footprint, two halves (§4)
    └── screenshots|videos|downloads/
```

**v2 overrides `screenshotsFolder`, `videosFolder` and `downloadsFolder`** to that run
directory, using the same config-override object at invocation that the `specPattern`
override in §3 already requires. This fixes three defects at once: v2 stops writing into
`cypress/snapshots/actual` where `cypress-visual-regression` compares against 38 committed
baselines; v2 stops trashing the developer's unrelated screenshots and videos; and
`trashAssetsBeforeRuns` becomes harmless rather than hostile, because the folder it trashes
is a fresh per-run directory that is already empty.

That last point is what makes §6's retention policy true at all: keeping every attempt log
is only worth doing if the screenshots it references still exist. Today they do not — the
next unrelated `cypress run` in that repo destroys them.

### 2. Where a generated spec lands: beside its scenario contract

`Q2`, `Q14`. **The spec lands next to the contract that asked for it** — `foo.scenario.md`
produces `foo.cy.ts` in the same directory. The author already chose the directory when
they saved the contract, which is the only way the team-vs-capability fact can be honoured:
nothing derives `appEnablementTeam` from a scenario about events.

It adds no contract field (a fifth consecutive ticket leaving the format alone), no
conventions field and no CLI argument to remember, and it makes §3 free — the output path
is a pure function of the contract path, so a re-run **cannot** produce a second file. The
three-duplicate-specs bug dies here, structurally, rather than being cleaned up.

**The scenario contract is therefore a committed artifact, and this corrects ticket 02:**
the committed, human-reviewed surface is **three** artifacts, not two — the
conventions/reachability index, the spec, and the contract. It is not optional. §6 discards
the IR and rests healing on re-derivation from the contract, which makes the contract the
**only durable input to a re-generation**. Uncommitted, a spec could be regenerated by
nobody but its author, on the machine they wrote it on. It also finally pays off ticket 08's
authoring interview, whose annotations sit next to the step they concern where the next
person reads them.

### 3. What may enter `cypress/e2e/`, and what happens on a re-run

`Q3`, `Q4`, `Q10`. **Probe specs never reach the target's spec tree.** They live in
`.cygen/probe/` and run under a `specPattern` override, which makes them structurally
incapable of being committed or picked up by the repo's own suite. That is gap 3 closed
properly rather than by discipline.

**The candidate spec gets a weaker guarantee, and the ticket's preferred answer is not
available.** "Written only to a scratch area until it passes the guardrail" fails on the
64-of-200 relative-import measurement: a spec compiled for
`cypress/e2e/platformTeam/settings/` does not run from `.cygen/`. Compiling for the working
path and rewriting imports on promotion means the file you verified is not the file you
ship — which is the thing ticket 02 built probe mode to avoid. So the candidate spec is
**written at its final path from the first iteration and deleted if the run does not end
green**, with §4's manifest sweep covering a killed process.

Re-runs: the path is deterministic, so the only remaining case is the human who hand-fixed
a generated spec. Each emitted spec carries a **provenance header** — content hash, tool
version, contract path — and the rule is one sentence: **v2 writes only to a path that is
empty or carries a matching header.** A changed hash means a hand-edit; no header at all
means a hand-written spec that happens to share the name. Both refuse and route to assist,
through one code path. Three header fields and no more: the run id would point into a
directory that gets swept, and git already knows the date.

This is the first thing in the design to write metadata into shipped code. Small, but it is
a house-style change and should be reviewed as one.

### 4. Abandoned attempts and the tenant footprint

`Q5`, `Q9`, `Q11`, `Q15`. **The ticket's gap 2 no longer exists as stated.** "The
exploration phase had no teardown discipline" was true of v1, but ticket 10 abolished
exploration as a phase and ticket 12 made the probe a compiled Cypress spec that keeps its
blessed setup moves. The residue is different and sharper: **a run that dies partway never
reaches its own teardown**, and ticket 12 guarantees dying partway is *normal*, not
exceptional — a probe that dies still returns everything it collected.

The footprint is recorded in a **run manifest with two halves**:

- **Static half — written from the IR before anything runs.** The IR is declarative, so the
  names a run will create are knowable in advance. This half cannot be crashed out of,
  because it is complete before the first entity exists.
- **Dynamic half — appended from observed `201` responses during the run.** This is what
  catches state created by *clicking*, which the IR cannot see: the IR knows a click landed
  on a Save button, not that a managed object was born. The probe already records responses,
  so the machinery exists. This half is *more precise* than the static one — a response
  carries a real id, not a name to look up — and it is as crash-safe as the facts document
  itself, which ticket 12 already guarantees is valid when incomplete.

Filtered to `201` with an `id` in the body. **Anything created that the sweep cannot delete
is recorded as unswept and reported**, which beats leaking silently and is a free hazard
candidate for ticket 08's governance loop.

**The sweep is v2's own tooling, not emitted code.** It needs no blessed move, no idiom and
no anchoring — those constrain what ships inside a spec. It runs at end of run (normal), at
start of run against any orphaned manifest (crash recovery), and on `cygen clean` (manual):
one function, three call sites. A blunt **prefix sweep** over the repo's own test-data
prefix ships behind a flag, because it is the only thing that catches an unswept creation,
and because on a shared tenant it would delete a colleague's in-flight data — a judgement
only the person who knows their tenant can make.

**One run at a time per repo, enforced by a lock file** holding runId and pid. This is not a
restriction the sweep invents: fixed literal entity names mean two concurrent runs against
one tenant collide on names whether or not v2 sweeps anything. Given that, serialising costs
nothing real and makes crash recovery correct by construction — dead process, stale lock,
safe to sweep. Without it the design has a live bug: run B would read run A's manifest as
orphaned and delete run A's data mid-flight.

**Assist keeps its spec file.** Ticket 10 made assist a supported outcome, so it is not the
failure that §3 deletes on. The file **stays at its final path**, marked not-green in its
header, with the manifest recording it so `cygen clean` can remove it. Moving it to
`.cygen/` was the cleaner invariant and it breaks on §3's own fact — relative imports stop
resolving, so the human cannot *run* the thing they are being asked to approve. The honest
invariant is weaker and worth stating exactly: **v2 never leaves anything red that is
committed.** The file is red, uncommitted, in the working tree, and the human was told. That
is the whole difference between abandoned and handed over.

### 5. Git: setup writes to the repo, runs do not

`Q6`. **A generation run never touches git.** It writes one spec and its own gitignored
working area, and the human commits. The `.gitignore` line for `.cygen/` rides along in the
**one-time reviewed commit that ticket 06's conventions scout already produces**, which
gives a clean line: setup writes to the repo, runs do not.

Reading git state to refuse on a dirty target path was considered and dropped — §3's hash
already catches the case that matters, without teaching v2 about git at all.

### 6. Artifact lifetimes

`Q7`, `Q8`, `Q12`, `Q13`.

| Artifact | Location | Lifetime |
| --- | --- | --- |
| Emitted spec | beside its contract | committed |
| Scenario contract | beside its spec | committed — **load-bearing**, see §2 |
| Conventions file / reach index | target repo (ticket 06) | committed |
| Probe spec | `.cygen/probe/` | deleted at end of the run that made it — only facts survive |
| Facts | `.cygen/facts/` | kept, TTL backstop, `cygen clean`; **never shared between developers** |
| Run manifest | `.cygen/runs/<runId>/` | deleted once its footprint is confirmed gone |
| Attempt log | `.cygen/runs/<runId>/` | **kept, all of it** |
| IR | `.cygen/runs/<runId>/` | ephemeral |

Facts are never shared, and that is settled by measurement rather than preference: they are
keyed by tenant URL, and the two repos already point at different personal tenants.

**The IR does not survive the run** — held weakly, and ticket 11's to confirm. Committing it
beside the spec creates a second reviewed artifact that drifts silently the moment a human
edits the `.ts`, and §3 tells us they do. Keeping it ephemeral holds the committed surface
at the three artifacts of §2. The bet is that re-deriving the IR from the contract is cheap;
if ticket 11 finds otherwise, this flips.

**Attempt logs are kept in full — reversing this ticket's own first-round answer.** "Keep
the last N" and "keep the assists, sweep the greens" are both wrong for the same reason: a
green run that took five iterations is the *only* record of what a scenario cost, and the
map lists **cost baseline** as an unvalidated assumption because the benchmark has never
been run against anything. Sweeping green logs would destroy the design's only source of
cost and flake data before that data exists. They are JSONL, one entry per iteration, capped
at six iterations by ticket 10 — too small to be worth deleting and too valuable to lose.

### Found by measuring

- **The ticket's preferred fix for gaps 1 and 3 is unavailable for the spec**, and available
  for the probe. "Write to a scratch area until it passes" founders on 64 of 200 host specs
  importing relatively; only the throwaway probe can have its imports emitted for `.cygen/`.
- **`trashAssetsBeforeRuns: true` in both repos makes v2 destructive today** — of the
  developer's own artifacts, and of the assist evidence a human opens later. Not of the
  loop's own diagnostic, which is read before the next run trashes it.
- **v2's failure screenshots currently land in `cypress/snapshots/actual`**, the folder
  `cypress-visual-regression` compares against 38 committed baselines.
- **The design as settled after `Q5` contained a live data-loss bug** — concurrent runs and
  orphaned-manifest recovery — found only by asking what two runs do.

### Corrects, and hands on

- **Corrects ticket 02** on two counts: the committed surface is **three** artifacts, not
  two — the contract joins it. And its `Q16(a)` facts policy is now located and bounded, not
  just characterised.
- **Corrects this ticket's own gap 2**: exploration teardown is not the problem; crash-safe
  teardown is. Tickets 10 and 12 dissolved the phase and replaced it with a probe that dies
  partway *by design*.
- **Hands ticket 13 a requirement:** the assist packet must name the spec's path and say it
  is uncommitted and red.
- **Hands ticket 06 a conventions field:** the repo's test-data prefix (`e2e`), for the
  opt-in prefix sweep. The teardown transport split (`cy.request` in the host, `c8yclientf`
  in the plugin) is already covered by the blessed vocabulary.
- **Hands ticket 12 a compiler requirement:** probe mode emits imports resolved for
  `.cygen/probe/`, not for a spec-tree path. Probe and spec mode already emit different
  code; the invariant is one IR and one runtime, never byte-identical output.
- **Hands ticket 14 an invocation requirement:** v2 launches Cypress with a config override
  object (`specPattern` plus the three asset folders), which rules out driving it as a bare
  CLI call.
- **Sharpens the "cost estimation" fog:** the attempt logs are now the data source that
  estimate will be built from, which is why §6 keeps all of them.
- Adds **zero IR verbs** and zero contract fields. It adds one comment block to emitted
  specs, which is a house-style change.

### New unvalidated assumptions

- **Re-deriving the IR from the contract is cheap.** The whole case for discarding the IR.
  Never measured. **Reopens** if ticket 11 finds healing needs the original IR.
- **The facts TTL default.** A backstop only — the per-entry key already carries tenant URL,
  app version and establishing IR prefix, so the TTL exists solely to catch a tenant edited
  by hand underneath a valid key. Ships as a knob with an arbitrary default. **Reopens** if
  a stale-facts failure is ever traced to it.
