# Agent runtime and cache-breakpoint strategy

Type: research
Status: resolved
Blocked by: —
Assignee: jdre

## Question

Graduated from fog by [Loop shape](10-loop-shape.md), which changed the question
materially. Under `Q3(b)` an iteration is a **short-lived, stateless session** reading
artifacts from disk, with a large static prefix (house rules read live from the target
repo, domain notes, the conventions index) and a small variable suffix (current IR, facts,
last diagnostic, attempt log).

That shape makes the runtime choice narrower and the cache question sharper.

- **Which runtime executes one iteration?** Anthropic Tool Runner (what v1 used), the
  Agent SDK, or Claude Code subagents. The surviving tool surface is small — `run_cypress`,
  `read_file`, `stage_fixture` — so the deciding factors are how the cache breakpoint is
  controlled, how images (failure screenshots) are attached, and how cleanly a session can
  be started and torn down per iteration.
- **Where does the cache breakpoint sit** given the static/variable split above? v1 moved
  breakpoints across accumulating attempts (`moveMessageCacheBreakpoint`); a stateless loop
  wants a fixed breakpoint at the end of the static prefix instead.
- **Does the TTL question still matter?** Ticket 10 established that prompt caching is
  **prefix-keyed, not session-keyed**, so the expensive preamble caches across separate
  iterations regardless. v1's late 1-hour-TTL fix was never empirically re-validated and
  was already only a reasoned hypothesis; ticket 10's correction may have made it moot.
  Confirm or retire it — do not carry it forward unexamined.
- **What is the actual cost profile** of the resulting call shape: large cached prefix,
  small uncached suffix, a handful of tool calls, one or two images?

Resolvable by a `/research` subagent against current Anthropic documentation plus the v1
implementation on branch `c8y-e2e-generation-agents`. Findings go to a throwaway
`research/agent-runtime` branch.

---

## Added by ticket 13 (assist handoff)

Two constraints, one of which turns this ticket's fourth bullet from a question into a
requirement.

**1. No runtime may assume a process that outlives a run.**
[Autonomy handoff](13-assist-handoff.md) made assist **terminal**: the run stops, exits, and the
human answers by committing to the conventions file or the scenario contract. Nothing parks,
nothing waits, and there is no resume protocol — so a runtime whose session model needs a
long-lived supervisor to be worth its setup cost is paying for something the design never uses.
Combined with `Q3(b)`'s stateless iterations, every session this runtime starts is short-lived
*and* may be the last one.

**2. Per-iteration cost must be recorded, not merely understood.**
This ticket's *"what is the actual cost profile"* now has a consumer. Ticket 13 requires an
assist packet to print the **cumulative cost across every run for this contract**, because v1's
measured failure was not that a scenario cost $4.22 — it was that the budget was *"silently
exhausted… three times in a row, with no visibility into why"*. That arithmetic runs over the
attempt logs, so the runtime must surface per-iteration cost (input, cached-read, output tokens
at minimum) in a form the log can hold. A runtime that reports cost only as an aggregate at the
end of a session, or not at all, fails this.

---

## Answer

Resolved by two `/research` passes — the Anthropic primitives, and forensics on the v1
implementation — plus a local payload-sizing measurement, because both this ticket and ticket 10
assert a "large static prefix, small variable suffix" that nobody had measured. Findings on
branch `research/14-agent-runtime`, at `.scratch/c8y-cygen-v2/research/14-runtime-and-caching.md`,
`…/14-v1-runtime-forensics.md` and `…/14-payload-sizing.md`; every claim cited to `file:line` or
a URL. SDK facts below are verified first-hand against `@anthropic-ai/sdk@0.111.0` as installed
at `packages/c8y-cygen/node_modules/`.

**Ruling: a manual loop over `client.messages.create`, three cache breakpoints, `1h` TTL on the
two stable ones, and `run_cypress` is not a model tool.** The runtime question turned out to be
the least interesting part; what decides it is a single missing accessor, and what the ticket
actually surfaced is that **the budget meters Cypress runs while cost accrues in model turns.**

### 1. The static/variable split, measured

Nobody had measured either half. Ticket 06 §5 keeps the two largest artifacts out of the prompt
entirely — *"Style → compiler only, never shown to the model … Reachability → looked up by route,
never dumped"* (`06-conventions-scout.md:189-191`) — which matters more than anything else here,
because the host repo's reach index is **85,155 B**, 3.4× the whole rest of the preamble. Had it
been dumped it would have dominated every figure.

What is left: house rules (6,683 B host / 5,620 plugin), domain notes (5,341), the conventions
file's model-facing span (10,432 / 6,855), the IR schema (11,215, and stale-low by five tickets'
growth), three tool schemas. **≈10,000 tokens.** The variable suffix runs **≈2,400 tokens at
iteration 1 to ≈6,700 at iteration 6**.

So the ticket's premise **holds at the start of a run and is false by the end of one**: 4.2:1 at
iteration 1, **1.5:1 at iteration 6**. Caching still pays — the prefix is the largest single
block and re-reading it six times uncached is pure waste — but the prize is bounded and
computable, not open-ended. And the term that closed the gap is the **attempt log**, i.e. ticket
11's choice to store a full IR snapshot per entry. **If per-iteration cost is ever observed
rising through a run, the fix belongs to ticket 11, not here.**

### 2. Runtime: a manual loop, decided by one missing accessor

**`Q1`.** The research pass recommended the Tool Runner; the forensics found the fact that
overturns it, and it is verified in the installed SDK:

- When `max_iterations` is reached the runner executes a bare `break`
  (`lib/tools/BetaToolRunner.js:144-150`) — no error, no flag.
- The count is a genuine private field (`_BetaToolRunner_iterationCount`, a `WeakMap`), and the
  class's only public getter is `get params(): Readonly<BetaToolRunnerParams>`
  (`lib/tools/BetaToolRunner.d.ts:113`). **There is no accessor.**

So a Tool Runner build **cannot distinguish "the model finished" from "the runner gave up"** —
which is not a nicety: ticket 10's trip condition 4 is *budget exhausted*, and ticket 13 rules
that budget exhaustion *"borrows whatever tier it stopped in"*. Both require knowing it happened.
v1 had exactly this hole (`agentLoop.ts:54-69`), and it is one of the three structural
blindnesses behind its signature failure.

A Tool Runner build must therefore count iterations itself — at which point the only thing it
still buys is the tool loop. And the tool loop is nearly absent (§3). Against that: the manual
loop is ~30 lines, produces **byte-identical wire requests**, exposes `usage` on every response,
and knows why it stopped. The research pass is right that the Tool Runner is a thin helper over
`POST /v1/messages` and hides no parameter — the disagreement is narrow, and it resolves on which
side of a 30-line trade leaves the simpler total system. It is the loop we write.

One further v1 lesson pointing the same way: controlling the breakpoint required mutating
`runner.params` through a `Readonly` view (`selfHeal.ts:368` against `.d.ts:113`) — an
unsupported coupling to SDK internals, needed *only* for the moving breakpoint that §4 retires.

**The Agent SDK is ruled out on two independent grounds**, either sufficient. It exposes **no
`cache_control` API at all** (*"You do not need to configure caching yourself"* — TTL only, via
env vars), which forecloses §4 outright. And it ships ~40 built-in tools on by default, including
`Write`, `Edit` and `Bash`. This design's entire safety argument is a closed tool surface: ticket
02 contains fabrication risk *"at exactly one place, the unanchored `stub`"*, ticket 12 makes
selector resolution a construction rather than a check, ticket 09 makes the output path
deterministic. An agent with `Write` bypasses the compiler; an agent with `Bash` runs Cypress
outside the run-denominated budget. Denying down from allow-by-default is not the same artifact
under review as adding to deny-by-default. It also forks a bundled CLI binary per iteration, and
its `total_cost_usd` is a self-declared estimate carrying an explicit *"Do not bill end users or
trigger financial decisions from these fields."*

**Claude Code subagents fail** on the plainest ground: no documented programmatic invocation from
an external Node process, and no exposed per-request usage.

All three surviving candidates satisfy ticket 13's constraint — none holds a session, a
subprocess or disk state that outlives a run.

### 3. `run_cypress` is not a model tool — the contradiction both passes found independently

**This ticket contradicted ticket 10 and neither noticed.** This ticket names the surviving
surface *"`run_cypress`, `read_file`, `stage_fixture`"* (`:19-20`), inherited from ticket 10's
fact #2 — which is an inventory of *v1's* tools that survive ticket 02's cut, not a positive
statement about who calls them. Ticket 10's own loop diagram says
**`[run Cypress] ← no model; the only metered operation`**.

The forensics settle it, because v1 ran the experiment by accident. v1's model had `run_cypress`
(`tools.ts:294-307`) **and** the harness re-ran Cypress independently right after
(`selfHeal.ts:391-399`), deliberately — *"rather than trusting the agent's own `run_cypress` call
or its final-turn summary"* (`:306-310`). That second run is **required**: ticket 01's anti-gaming
guard depends on the tool, not the model, observing the result. So a model-callable
`run_cypress` leaves exactly two options, and both are unacceptable:

- run twice — **every attempt costs two Cypress runs**, and a budget denominated in Cypress runs
  is silently halved; or
- trust the model's own run — which re-opens the anti-gaming hole ticket 01 exists to close.

**Under a budget denominated in Cypress runs, a model-callable run is a model-callable budget.**
The harness owns the run, as ticket 10's diagram always said.

That leaves at most `read_file` and `stage_fixture`, and **most iterations will make zero tool
calls**. Whether either survives is a question for the spec — ticket 07 shows the model a
*summary* rather than rows, which is the one argument for a `read_file`-shaped ask; ticket 15's
anchoring rule may make `stage_fixture` deterministic compiler work. The runtime decision is
robust to the answer: a manual loop handles 0, 1 or 2 tools identically. The fewer tools, the
more decisively it wins.

### 4. Three breakpoints, one per stability tier

**`Q2`.** Explicit markers, not top-level automatic caching — the design has three genuine
stability boundaries, and automatic placement gives one, landing *after* the unique tail on any
single-request iteration, which is a pure write surcharge.

| BP | Position | Span | TTL |
| --- | --- | --- | --- |
| **BP1** | last `system` block | `tools` + `system` — house rules, domain notes, conventions span, IR schema | **`1h`** |
| **BP2** | end of the scenario-stable span, first user message | scenario contract | **`1h`** |
| **BP3** | end of the first user message | IR, facts, diagnostic, screenshot, attempt log, progress line | `5m` |

`tools` and `system` cache together under BP1 by the render-order rule, so BP1 is one marker
covering both.

**The ticket's named worry — house rules read live from the target repo — is not a real hazard.**
The file is committed at a fixed path; at one commit its bytes are identical on every read. The
hazard is **normalisation**, not liveness: any trailing-newline trim, line-ending rewrite or
markdown re-render between read and send makes the bytes a function of the code path. *Read once
per process, pass the bytes verbatim, never re-read per request.* Same rule for the two schemas:
**ship them as literal JSON bytes, never `JSON.stringify` a rebuilt object or derive them from
Zod at request time** — key order is not contractually stable, and a tool-definition change is
the one invalidation with no cache-preserving escape hatch on any model.

**The trap worth naming:** the progress line (*"run 3 of 6"*) reads like an instruction, so it is
tempting to put it in `system`, where it would invalidate the entire prefix every iteration. It
is per-iteration state. It goes in the suffix.

**`moveMessageCacheBreakpoint` is retired.** Its purpose was managing an accumulating history
that ticket 10 abolished; a fourth moving marker on the intra-iteration tail is worth **$0.027
per scenario**. v1's system-block breakpoint *is* the v2 breakpoint; the moving one is what does
not survive. Revisit only if an iteration routinely exceeds ~8 tool round-trips — and the answer
then is automatic caching for the tail, not a hand-moved marker.

### 5. The 1-hour TTL: adopted fresh, because the "fix" never existed and its reason was wrong

**`Q3`.** The ticket asked to confirm or retire v1's late 1-hour-TTL fix. Both halves of the
premise fail.

**It was never applied.** Not in any commit, on any ref, in any dangling object. v1 shipped plain
5-minute `{ type: "ephemeral" }` at `selfHeal.ts:204` and `:360`. v1's own pricing module, added
2026-08-08 and never edited afterwards, says so in writing: *"since c8y-cygen never requests a 1h
cache TTL"* (`modelPricing.ts:81`). So this ticket's *"never empirically re-validated"* should
read **"was never applied"** — it was not a fix, only a reasoned hypothesis about one. There is
nothing to carry forward and nothing to retire.

**And v1's reason was void anyway.** The rationale was about session boundaries; ticket 10 is
correct that caching is prefix-keyed, so a boundary costs nothing. **The clock decides the TTL,
and ticket 10 did not do that arithmetic.** With `P` = 10,000 tokens, six iterations sharing it,
and `m` gaps exceeding the TTL:

```
5m TTL:  1.25 + 1.25m + (5 − m)(0.1)  =  1.75 + 1.15m
1h TTL:  2.00 + 5(0.1)                =  2.50
break-even:  m = 0.652
```

**One inter-iteration gap over five minutes flips it.** The design has exactly one candidate
event: a Cypress run — a full Electron process against a live tenant, in a repo whose specs
ticket 09 measured bootstrapping the shell 10–17 times per file. A lint failure is seconds.

The wall-clock is **UNDETERMINED** — there is no clock anywhere in v1's loop, and the benchmark
has never been run. But the asymmetry decides it without the measurement: **the 1h TTL costs
$0.0375 per scenario when unnecessary and saves up to $0.25 when necessary, a 6.7:1 payoff
against an event more likely than not.** So: `ttl: "1h"` on BP1 and BP2, default `5m` on BP3,
which is rewritten every iteration anyway.

Keep-alive pings (`max_tokens: 0` pre-warming) **lose** here — 12 pings at $0.005 against a
$0.0375 write premium. This inverts the general advice, correctly: that advice is scoped to
models reading at 0.025×, and both candidates here read at 0.1×.

Two caveats for the spec: a 6-run scenario may itself exceed an hour, so the 1h entry is better
at every cadence but not a guarantee; and **neither TTL survives an assist** — assist is terminal
and a human answers by committing, so the first iteration of every run pays a cold write. That is
the honest floor on per-run cost, ~$0.10 on Opus 5.

### 6. Cost profile, and the model this ticket has to name

**`Q4`.** Ten iterations, six runs, three requests per iteration:

| | Opus 5 | Sonnet 5 |
| --- | ---: | ---: |
| per scenario | **≈$1.50** | **≈$0.60** |
| same shape, caching off | ≈$3.20 | ≈$1.30 |

**Caching saves ~53%.** The honest range is **$1.1–$2.3**, and the uncertainty is not caching —
**output tokens are 41–46% of the bill** and `O ≈ 3,000` is the least-supported number in the
analysis. Two caveats push every figure up: the 4-bytes-per-token conversion is likely ~30% low
(both candidates use the newer tokenizer), and iteration 6's suffix growth is ticket 11's, not
this ticket's.

**The map never pinned a model** — ticket 10 settles *"one model throughout beats tiering"* and
records only that v1 used `claude-sonnet-5`. A spec that says "one model" without naming it is not
implementable, and three decisions here are model-gated. **This ticket names `claude-opus-5`,
provisionally**, and the decisive argument is not dollars but ticket 10's own stated trap: *"a
weaker model that causes one extra iteration adds a whole large-context call **and** a Cypress
run."* One extra run is **one sixth of the scenario's entire allowance**, spent to save $0.90.
The run-denominated budget is precisely what punishes a weaker model hardest. Opus 5 is also the
only candidate supporting the operator channel in §8. The map's existing revisit rule stands
unchanged; nothing else in this ticket moves if the model does.

### 7. Per-iteration cost is recorded — and the budget meters the wrong thing

**`Q5`.** Verified against the installed SDK (`resources/messages/messages.d.ts`), the response
`usage` object carries `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`,
`output_tokens`, `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens`, `service_tier`,
`inference_geo`, and — not found by either pass — **`output_tokens_details.thinking_tokens`**.
That last field is worth having: output is the largest and least-measured term in §6, and
separating thinking from IR-authoring tokens makes *"is `effort: high` paying for itself"*
answerable from the log instead of needing a new experiment.

**`input_tokens` is the uncached remainder only.** Total prompt size is the three input fields
summed. Logging `input_tokens` alone under-reports by the whole prefix — the exact mistake that
would make a cost record look implausibly cheap.

**Dollars must be computed client-side from a pinned table.** There is no cost field on the
response, and the Usage and Cost Admin API cannot serve this: org-wide, ~5 minutes lagged, and
*"a key shared across projects blends their traffic — making per-project reads unattributable"*.
So the log records **raw counts plus the price-table version** — otherwise a rate change silently
rewrites history and ticket 13's cumulative-per-contract figure stops being comparable across
time. v1's table is the cautionary case: one model, a key that yields `no pricing on file` on any
alias mismatch, and an introductory rate that **expired 2026-09-01**.

**The sharper finding. The budget meters Cypress runs; cost accrues in model turns; nothing
meters those.** Ticket 10 pins ≤3 probe / ≤6 total runs and *"dollars are reported alongside but
do not enforce"*. Ticket 13 then records that a model retrying a frozen-field edit *"loops for
**free** — free in Cypress runs, the one resource the budget does not meter"*, and ticket 10's
linter can reject an IR locally at the cost of a turn and no run. **So dollars burn while the
enforcing counter does not move** — v1's *"silently exhausted with no visibility into why"* in a
new costume, and it lands here because this ticket owns per-iteration cost.

Spend *is* observable as it accrues — `usage` per response, and mid-response via `message_delta`
under streaming. But **task budgets are inert for this design**, on four independent grounds: a
user message carrying no tool results *"starts a new turn with a fresh budget"*, and every
stateless iteration opens with exactly that, so they cannot survive the process boundary; the
minimum `total` is 20,000 tokens against a ~3,000-token iteration; `claude-sonnet-5` does not
support them at all; and the server-injected countdown marker is an unquantified cache hazard.

So the cap is client-side, and this ticket specifies it: **a per-run model-turn counter, written
to the attempt log beside the run counter.** The design already caps rejected diffs at two per
failure — that *is* a turn cap; it is simply never counted anywhere a human can see. Counting it
puts lint-thrash in the same record the run budget lives in, which is what ticket 13's packet
needs to print. Plus a mid-run dollar figure, reported not enforced, so a thrash loop announces
itself rather than being reconstructed afterwards.

### 8. Images, effort, and the operator channel

**`Q6`.** The screenshot lives in the **variable suffix, never the prefix** — and the reason the
three-tier layout works is that adding or removing an image invalidates only the messages cache,
not `tools`+`system`. At a 1000×660 Cypress viewport a screenshot is **864 visual tokens**
(`⌈w/28⌉ × ⌈h/28⌉`), negligible. **Cap it anyway:** a tall full-page capture is 3,888 tokens and
is *not* auto-downscaled, sitting under the cap that would trigger it. v1 attached raw PNGs with
no resizing at whatever viewport the target repo configured (`selfHeal.ts:112-133`).

With §3 settled, the block shape follows: the harness runs Cypress, so the screenshot is a
**user content block**, not a `tool_result`. That is v1's shape, and `loadScreenshotImageBlocks`
is worth salvaging — minus the message-chaining it currently feeds.

**`Q7`.** `effort: "high"` with explicit adaptive thinking, both **pinned as constants**. An
effort change always invalidates the messages cache, and Opus 5's per-message escape hatch is
useless across process boundaries — so **tiered effort is structurally unavailable here**, which
independently reinforces ticket 10's one-model decision with a mechanical reason rather than a
prudential one. **Never disable thinking:** the documented failure mode is a tool call written
into visible text — the turn succeeds, the call never runs, no error is raised — which under a
run-denominated budget is a silently wasted iteration.

The mid-conversation `{"role": "system"}` channel: its cache-preservation purpose is moot in a
stateless single-turn iteration, but **its non-spoofable-operator property is not**. This design
feeds the model file content and tool results from a repo it does not own. Opus 5 supports the
channel; Sonnet 5 returns a 400. Worth recording as available, not adopted here.

**One more, unasked:** parallel scenarios all miss the cache, because an entry becomes available
only after the first response begins. Five oracles in parallel is 6.25 versus 1.65 units of
prefix — **$0.23 wasted per batch**. Ticket 09 already forces one run at a time by lock file for
tenant-footprint reasons; this is a second, independent reason the same rule is right. Recorded so
nobody "optimises" the benchmark by parallelising it.

### 9. Verification the design owes itself

A caching regression is silent and expensive — requests keep succeeding, the bill is just higher.
Two standing checks, both cheap, both adopted:

1. **An integration assertion** that a second identical request shows
   `cache_read_input_tokens > 0`. One test, in CI, no tenant needed.
2. **A hash of the BP1 span in every attempt-log entry.** With the token counts from §7 this makes
   *"why did this run cost more?"* answerable from the log alone — which is exactly ticket 13's
   purpose. It also diagnoses the two invalidators nobody had considered: **cache isolation is
   per workspace**, so two teammates do not share a prefix cache and their cumulative-cost
   figures are not comparable; and a developer with uncommitted edits to the house-rules file gets
   their own namespace, correctly but invisibly.

### 10. Corrections to the map

- **Corrects this ticket's own premise**, twice. The 1-hour-TTL fix *"was never empirically
  re-validated"* → **was never applied**; and the *"large static prefix, small variable suffix"*
  is 4.2:1 at iteration 1 but **1.5:1 by iteration 6**.
- **Corrects [Hygiene](09-hygiene.md).** Its invocation requirement — a config override object,
  *"which rules out driving it as a bare CLI call"* — **endorses v1's shape rather than ruling it
  out.** v1 already used the programmatic module API resolved out of the target repo, already
  passing an optional `config` object (`cypressRunner.ts:87-92`); it only ever held `{ baseUrl }`.
  Ticket 09 eliminated a shape v1 never used. The requirement is met by a one-line change, and
  `cypressRunner.ts` is the strongest salvage candidate in v1.
- **Corrects the record on v1's signature failure.** *"Silently exhausted three times in a row"*
  was **one CLI run burning all three self-heal attempts** — 150 model turns producing nothing,
  per v1's own comment at `cli.ts:37-39`. The benchmark README's "three runs" is a reconstruction.
  The failure is no less damning; it is a different shape, and its causes are now located: the
  runner cannot report exhaustion, `sessionRecord` is never reset between attempts so the
  *"you have not called write_spec"* guard can only fire once, and the cost figure arrives in a
  `finally` that `SIGINT` skips.
- **Corrects [Loop shape](10-loop-shape.md)'s budget on two counts.** Its fact #2 tool inventory
  reads as a v2 tool surface and contradicts its own loop diagram (§3). And its unit is sound but
  incomplete: v1 ran Cypress **twice per attempt**, and model turns are unmetered entirely (§7).
- **Corrects the map's cost baseline downward in confidence.** `$4.22` / `$2.42` trace to exactly
  one primary source, the groundwork document — no log, commit or fixture holds either — and were
  computed at the **introductory $2/$10 Sonnet rate that expired 2026-09-01**. An identical token
  profile costs **1.5× more today**. The most trustworthy cost datum v1 produced is in-code, not
  in prose: **one attempt's accumulated turns exceeded 1M tokens** (`browserTools.ts:6-13`).
- **Hands [Heal granularity](11-heal-granularity.md) a cost consequence:** its full-IR-snapshot
  -per-log-entry choice is what makes late iterations dearer than early ones. Not reopened — the
  reasoning still holds — but it now owns a measurable side effect.
- **Confirms [Heal granularity](11-heal-granularity.md)'s truncation finding, and sharpens it:**
  the head-first 3,000-char cut exists in **two** files with two separate constants
  (`selfHeal.ts:92`, `tools.ts:40`). Fixing it in v2 means fixing it twice.

### What this adds

**Zero IR verbs and zero contract fields** — the sixth consecutive ticket to leave the contract
format alone. **Three attempt-log fields:** the per-iteration usage record (four token counts, the
5m/1h split, `thinking_tokens`, and the price-table version), the BP1 prefix hash, and the
per-run model-turn count. **One CI assertion.** **One pinned constant** (`claude-opus-5`), with
the map's existing revisit trigger unchanged.

### New unvalidated assumptions

- **A Cypress run's start-to-start gap exceeds five minutes.** The entire 1h-TTL decision turns
  on it, and it has never been measured — there is no clock in v1's loop. The asymmetry (§5)
  makes the decision safe either way. **Reopens the TTL choice** if the gap is measured
  consistently under five minutes, in which case 5m is strictly cheaper.
- **Output tokens ≈3,000 per iteration.** 41–46% of the bill and the dominant uncertainty in
  every dollar figure here. **Reopens §6's arithmetic**, not its conclusions, once one real
  iteration has been run.
- **The 4-bytes-per-token conversion.** Likely ~30% low for both candidate models. Settleable for
  free with `messages.countTokens` against a real assembled prompt, and it should be done before
  any figure in §6 is quoted as measured rather than estimated.
