# Autonomy handoff: the assist packet and the way back in

Type: grilling
Status: resolved
Blocked by: —
Assignee: jdre

## Question

Graduated from fog by [Loop shape](10-loop-shape.md), which made both halves specifiable:
`Q4(b)` named the four conditions that trigger assist, and `Q7(b)` established the
append-only attempt log as the artifact that would carry it.

Charting settled that a structured human-assist path is a **first-class supported
outcome**, not a failure — asking early beats burning $4 guessing. What it presents, and
how an answer re-enters, is undecided.

The four trip conditions from ticket 10 are not alike, and may not deserve the same
treatment:

1. **No blessed setup move exists** for a required precondition. The human is being asked
   to approve a *new entry in the repo's setup vocabulary* — a durable change that
   outlives this run and benefits every later one (ticket 02 made the vocabulary the
   primary cost lever, so this is the growth mechanism).
2. **A required selector is absent from every candidate table.** The human is being asked a
   question about the application, and the honest answer may be "that element does not
   exist; the scenario is wrong".
3. **An Expected Outcome cannot be mapped to an assertion.** The human is being asked to
   reinterpret the *scenario*, which is ticket 08's artifact.
4. **Budget exhausted.** No specific question at all — just state plus a request for a
   human to look.

Resolve:

- **What is in the packet?** The attempt log's format is the concrete sub-question: what
  each iteration must record for a human — or a later stateless session — to act on it
  without the originating session's reasoning.
- **Is it one packet shape or four?** Conditions 1 and 3 are approval requests with a
  proposed answer attached; 2 and 4 are closer to "here is where I am, please look".
- **How does an answer re-enter a stateless loop?** Under `Q3(b)` there is no session
  waiting. Does the human edit the IR directly, answer in a file the next session reads,
  or approve a proposal the tool then applies? Does the run resume, or restart with a
  larger budget?
- **Is assist synchronous or asynchronous?** Blocking a run on a human contradicts
  unattended operation; parking it and resuming later needs the run's state to survive,
  which `Q3(b)` already provides for free.
- **Does an approved setup move get written back** to the conventions artifact (ticket 06),
  and is that automatic or a separate reviewed commit?

Audience is team adoption, so this is an adoption blocker, not polish.

---

## Fifth trip condition, from ticket 12

[Probe mode](12-probe-mode-compiler.md) added a fifth condition to the four ticket 10
named, and it is the cheapest of the five:

5. **An ambiguous provisional selector.** The probe's structural guess
   (`{ tag: button, text: 'OK' }`) matched more than one element. Because ticket 12 made
   selector resolution *deterministic* — the probe records which element it touched and the
   ladder picks the selector — an ambiguous match would silently become a **committed
   selector for an element the model never meant**. So resolution refuses above a match
   count of one.

This one is worth designing for specifically, because it is the clearest case where assist
beats autonomy on pure economics: *"three buttons say OK, which did you mean?"* is answered
by a human in two seconds and guessed at by a model for four dollars. It also comes with
its own answer shape — a choice among enumerated candidate rows, not free text — which may
argue for a different packet than the other four conditions.

---

## Added by ticket 15 (runtime values)

**The trip-condition list does not grow to eight. It collapses.**

Ticket 10 named four conditions and ticket 12 added a fifth (an ambiguous provisional match).
Ticket 15 produced three more candidates — no value builder exists, no blessed setup move exists,
and a named helper is missing from the conventions list — and then ruled that all of them are
**one** condition:

> *The IR needs a vocabulary entry that does not exist.*

This ticket's own text already describes its first condition as *"the human is being asked to
approve a new entry in the repo's setup vocabulary — a durable change that outlives this run and
benefits every later one."* That sentence covers setup moves, value builders, comparators and
helpers without a word changed.

Consequences for this ticket:

- **One packet shape** serves the whole class. It names the missing entry, the step that wanted
  it, and what the entry would be used for — and its answer is a **commit to the conventions
  file**, not an answer typed back into a run.
- The growth mechanism is therefore the same in every case, which is what makes the vocabulary
  the primary cost lever ticket 02 called it.
- The condition count is **five**, not eight: three vocabulary conditions merged into condition 1.

---

## Added by ticket 05 (two genres)

**A sixth trip condition.** Ticket 15 collapsed eight candidate conditions into five;
[Two genres](05-two-genres-one-pipeline.md) adds one back, so this ticket now designs the
assist packet for **six**.

The new one: **the IR has zero DOM steps.** That is the recognition criterion for the
API-contract genre, which is now out of scope. It fires at **lint time**, before any probe
run is spent — so unlike the other five it costs nothing and carries no diagnostic from a
failed run.

That makes it a different *shape* of assist from the rest, and this ticket owns whether the
packet accommodates that:

- The other five say *"I tried, here is the failing assertion and a screenshot."* This one
  says *"I will not try, and here is why."* There is no screenshot, no failing assertion, no
  proposed patch.
- It has **no way back in**. The other conditions resume once the human answers. This one is
  terminal for the scenario — the answer is "this belongs to a different effort", not
  "here is the missing selector".
- It is the only condition that can fire on a *well-formed* IR. The IR is valid; it is
  simply not something v2 generates.

If the packet's shape assumes a failed run, this condition breaks it.

**Also relevant:** ticket 05 rejected the directory-based criterion partly because
`global-context/globalContextWidgetDisplayModes.cy.ts` has zero `cy.get` yet is fully
DOM-driven through an imported helper module. The equivalent hazard here is a *false*
refusal — an IR that looks DOM-free but is not. The named accepted cost is
`appEnablementTeam/branding.schema.cy.ts` (18 lines, 1 `cy.request`, no DOM), 1 in-scope
host spec of 154.

---

## Added by ticket 08 (scenario authoring)

Two things, one of them a correction to a shape this ticket assumes.

**1. The packet has a second consumer: it is how the hazard list grows.**

[Scenario authoring](08-scenario-authoring-assist.md) settled that **every assist event is a
hazard candidate**, promoted to the authoring interview by a human when it recurs. The
admission bar it set — *observed at least once in a real failure* — is satisfied by exactly one
thing, and that thing is an assist event.

So the attempt log and this packet are not only a way back into a stalled run. They are the
evidence stream for a durable artifact, and that is a second audience with different needs: the
first reader wants *"what do I do now"*, the second wants *"has this happened before, and to
what class of scenario"*. Whether one record serves both, or the promotion step reads the log
rather than the packet, is this ticket's call.

This matters because v1 measured the alternative. Its `prompts/domain-notes.md` asked in its own
header to accumulate as gotchas were found, no tool could write to it, and it received **two
hand commits in its entire life**.

**2. Two conditions now fire before any run, not one.**

This ticket's §"Added by ticket 05" observes that condition 6 (zero DOM steps) is different in
shape — it fires at lint time, so it carries no screenshot, no failing assertion and no proposed
patch. **Condition 1 belongs in that group too.**

Ticket 08 tried to move the *"no blessed setup move"* check earlier still, onto the scenario
contract, so a human could see it before a model turn. That failed on measurement: matching
Setup prose to a repo inventory is the same operation that made its hazard 6 unusable. The check
stays exactly where it is — but the finding is that it fires when the **IR** first fails to lint,
which is before any probe run is spent and therefore before any diagnostic exists.

So the packet cannot assume a failed run for conditions 1 and 6. The split is not
*five-plus-one*; it is **four post-run conditions and two lint-time conditions**, and the two
lint-time ones differ from each other: condition 6 is terminal for the scenario, while condition
1 is the growth mechanism for the blessed vocabulary and resumes once a human commits the entry.

---

## Added by ticket 11 (heal granularity)

**A seventh trip condition, and it is the first one that is a question about the
*scenario* rather than about the repo.**

7. **The app contradicts the scenario.** The selector resolved, the element is in the
   candidate table, the assertion ran — and the result disagrees with the Expected
   Outcome. *"The page shows 1, the scenario says 3."*

It is deliberately **not** folded into an existing condition. Not condition 2 (a required
selector absent): the selector resolved and the row exists. Not condition 3 (an outcome
cannot be mapped): that fires at lint time with no diagnostic, and this ticket has already
split its packet on exactly that line. So the tally is **five post-run conditions and two
lint-time**, and it does **not** join the vocabulary class ticket 15 collapsed — its answer
is a decision about the scenario contract, not a commit to the conventions file.

Two ways it fires, both from ticket 11:

- **Declared.** A patch turn may return an **assist request instead of an IR** when the only
  available fix would touch a frozen field (what the step asserts, rather than how it finds
  its target). Backstop: one rejected diff is re-prompted with its reason; a second on the
  same failure fires assist. The cap exists because a model retrying a frozen edit loops for
  *free* — free in Cypress runs, the one resource the budget does not meter.
- **Proven.** The re-probe's ladder resolves to the selector that just failed. The element
  is there and the selector is right, so the failure was never a selector problem. Assist
  fires **without spending the confirming run**, and this variant carries the strongest
  packet of any condition: *"this selector is correct — the probe just observed it — and the
  assertion still fails."*

**Attempt-log fields ticket 11 requires**, which is the concrete half of this ticket's
"what does each iteration record" question:

| field | why |
| --- | --- |
| full IR snapshot | tens of lines, ≤6 attempts; replaying diffs backwards saves nothing worth a code path that drifts |
| changed field paths | **computed from the diff, not claimed by the model** |
| the run it produced | ties an attempt to its diagnostic and its cost |
| failing step path | from the source map; the field v1 never had |
| capped diagnostic | parse the location out of `displayError` **before** truncating, and truncate the middle — the stack frames are at the end, and v1's head-first 3000-char cut deletes them on exactly the largest failures |
| accept / reject verdict on the diff | see below |

**The rejected diffs are as important as the accepted ones.** A rejection records that the
model wanted to weaken an assertion — which is ticket 08's hazard evidence stream in its
purest form, and the only place the design ever observes the fabrication pressure it was
built to resist.

**One packet requirement:** the **source map** must survive an assist alongside the red spec
file ticket 09 already keeps. Without it the packet cannot name a step, and every condition
above degrades to string-matching.

---

## Answer

**Assist is not a pause. It is an ending, and the answer comes back as a commit.** The run
stops, writes down what it knows, and exits. A human changes one of exactly two committed
files. A fresh run starts, and the facts cache makes it cheap in precisely the cases where it
should be cheap. There is no parked state, no resume command, and no process waiting on a
human — which is the only shape compatible with ticket 10's stateless sessions, and it turns
out to cost nothing to get.

### 1. The seven conditions sort by evidence, not by clock

This ticket inherited the split *lint-time vs post-run*, and inherited it wrong. `CONTEXT.md`
records *"five after a run, two at lint time"*; ticket 11 wrote that line and its own text
contradicts it, saying condition 3 *"fires at lint time with no diagnostic"* and then counting
3 as post-run. On its own axis the tally is **four post-run and three lint-time**.

But the clock is the wrong cut. What determines the packet is **what evidence exists when it is
built**, and that is three tiers, not two:

| tier | what the packet can carry | conditions |
| --- | --- | --- |
| **nothing ran** | contract, IR, conventions file | 1 vocabulary gap · 3 outcome unmappable · 6 zero DOM steps |
| **a probe ran** | + facts, candidate table | 2 selector absent · 5 ambiguous provisional |
| **a spec ran** | + diagnostic, screenshot, source map, attempt log | 7 app contradicts scenario |

**Condition 4 — budget exhausted — is in no tier.** It is a cap, not a question. It fires
wherever the run happened to be and its packet is whatever that tier already produces. So it
needs no shape of its own, and the count of *shapes* is three where the count of *conditions*
is seven.

### 2. One envelope, three tiers

The ticket asked whether it is one packet or four. It is **one envelope whose sections are
present when the evidence exists and absent when it does not**. A tier-1 packet has no
screenshot because nothing ran — not because condition 6 has a bespoke rule.

The envelope always carries: the trip condition, the question in one sentence, the contract
path, **the spec path plus "uncommitted, red"** (ticket 09's requirement), the cumulative cost
for this contract (§6), and what the human is being asked to change. Then the tier sections.

Rejected: seven bespoke packets — six of the seven differ only in fields the tier already
explains. Rejected: one flat shape — it forces a lint-time stop to carry empty slots where a
screenshot would go, which reads as a missing screenshot rather than a run that never happened.

### 3. The packet is a view of the attempt log, not an artifact

Ticket 08 gave this packet a **second consumer**: every assist event is a hazard candidate, and
the admission bar — *observed at least once in a real failure* — is met by exactly one thing,
an assist event. Two readers with different needs: *"what do I do now"* and *"has this happened
before, and to what class of scenario"*.

They do not need two records. **The attempt log is the store; the packet is a rendering of it
plus the trip condition.** One store, two readings, nothing new persisted, and no way for two
records of the same run to disagree.

That fixes what the log must hold — the concrete half of this ticket's *"what does each
iteration record"*. Ticket 11's six fields, plus two this ticket adds:

| field | source |
| --- | --- |
| full IR snapshot | ticket 11 |
| changed field paths | ticket 11 — **computed from the diff, not claimed by the model** |
| the run it produced | ticket 11 |
| failing step path | ticket 11 |
| capped diagnostic | ticket 11 — location parsed out **before** truncation, middle truncated |
| accept / reject verdict on the diff | ticket 11 — **the rejections are the evidence stream** |
| **the trip condition, if the run ended in one** | this ticket |
| **the source map** | this ticket, resolving ticket 11's requirement |

On the source map: **store it, do not recompute it.** The compiler is deterministic so
recomputing is possible, but ticket 11 already rejected replaying-backwards because it *"saves
nothing worth a code path that drifts"*, and that argument transfers here unchanged.

### 4. Two destinations, both committed

**How an answer re-enters a stateless loop: it does not re-enter. It is committed, and the next
run reads it like any other input.**

| condition | where the answer lands |
| --- | --- |
| 1 vocabulary gap | the **conventions file** (settled by ticket 15) |
| 2 selector absent | the **scenario contract** — Steps, or Expected Outcomes if the scenario is wrong |
| 3 outcome unmappable | the **scenario contract** — Expected Outcomes |
| 5 ambiguous provisional | the **scenario contract** — an annotation next to the step |
| 7 app contradicts scenario | the **scenario contract**, or nothing at all (§10) |
| 4 budget exhausted | none of its own |
| 6 zero DOM steps | none — terminal |

Rejected: **the human edits the IR** — it is ephemeral and no human speaks it. Rejected: **an
answer file the next run reads** — a fourth artifact whose only job is to be read once, and
untracked, so the answer is lost to everyone but its author.

The property the chosen shape has and the others do not is that **the answer is durable and
transferable**. The answer to *"three buttons say OK, which did you mean?"* is not *"row 2"* —
it is *"the OK in the confirmation dialog"*, which still holds when the page grows a fourth OK,
and which lands exactly where ticket 08's authoring interview already puts annotations: next to
the step it concerns, in the artifact ticket 09 made load-bearing and committed.

The cost is real and accepted: prose → model → selector is a lossier channel than a direct row
pick, so the model can get it wrong twice. Durability is worth more than exactness on an answer
a human otherwise re-gives on every run.

### 5. Assist ends the run, and the facts cache is why that is cheap

The standing objection to a terminal assist is that a restart re-spends the budget. **The facts
cache already kills that objection, with no rule added.** The key is tenant URL, app/plugin
version and the establishing IR prefix, so tracing all five answerable conditions:

- **5** (ambiguous provisional) and **7** (app contradicts) leave the flow unchanged, so the
  prefix is unchanged, so the cache **hits** and the re-run spends no probe run.
- **2** (*"reach it via a different page"*) and **1** (a blessed move replaces a sequence of
  clicks) both **change** the establishing prefix, so the key **misses** — exactly where
  re-probing is genuinely required.
- **3** (Expected Outcome rewritten) changes assertions, not the establishing prefix: hits.

Restart is already cheap where it should be cheap and correctly expensive where the human
changed the flow. So the parked-state machinery of a resume protocol buys nothing that is not
already paid for, and **`Q3(b)`'s stateless sessions — the decision that created this ticket's
"there is no session waiting" problem — turn out to solve it.**

Rejected: **park and resume** — a state machine earning nothing. Rejected: **block and prompt**
— it contradicts unattended operation and requires inventing a waiting process the design does
not otherwise have.

### 6. Budget: full each run, no cap, cumulative cost printed

Every run gets the full budget (≤3 probe, ≤6 total). **Nothing caps how many times one contract
may assist.**

A cap was rejected on ticket 08's own governance rule — *only a fact may block a run*. A count
of prior assists is a policy number, and the map lists **cost baseline** as an unvalidated
assumption, so there is nothing to set it from. The real governor is that a human decides to
spend each time.

What makes that governor work is the one thing v1 lacked: **the packet prints the cumulative
figure across every run for this contract** — runs spent, assists so far, dollars where known.
v1's failure was not that a scenario cost $4.22; it was that its budget was *"silently
exhausted… three times in a row, with no visibility into why"*. The number goes in front of the
human before they decide to spend again.

### 7. Three ask-shapes, by how closed the answer set is

The ticket's own framing — *"1 and 3 are approval requests with a proposed answer attached; 2
and 4 are closer to here-is-where-I-am"* — is close, but the line is not approval-vs-look. It is
**how closed the set the answer comes from is**:

- **Proposal** — the answer comes from a closed vocabulary **the tool owns**. Conditions **1**
  (blessed moves, value builders, helpers) and **3** (the extractor and comparator lists are
  closed, so the packet shows what was tried and what remains).
- **Menu** — the answer comes from a closed set **the probe observed**. Condition **5** only:
  the matching rows, each with its ancestor list, so the human can tell them apart. The answer
  is still prose (§4); the menu is what makes the prose accurate.
- **State only** — the answer is an open question about the application or about intent.
  Conditions **2, 4, 6, 7**.

The rule underneath: **the tool proposes only from vocabularies it owns, menus only from rows it
observed, and never proposes a fact about the application.** Proposing there is guessing, which
is what ticket 12 spent a whole ticket making structurally impossible.

This is a second axis, orthogonal to §1's. §1 says what **evidence** the packet carries, by what
ran. §7 says what **ask** it makes, by how closed the answer set is.

### 8. The tool writes facts unasked; it writes judgements on request

Two writes leave an assist, and they are governed differently.

- The **contract line** — date, trip condition, question — is written by the run as its last
  act, unasked.
- The **conventions entry** is written into the working tree only when a human asks for it, by a
  separate command. It arrives ready-made and unstaged; the human reviews and commits.

The split is not arbitrary. *"This run stopped here, with this question"* is a **fact**. *"This
command should be blessed"* is a **judgement** about the one artifact ticket 06 made a human
curate — and ticket 06's whole argument for the two-artifact split is that a stale conventions
entry **ships**, where a stale reach-index entry costs one probe run and self-corrects.

Rejected: the tool commits the entry — it takes the judgement away from the only artifact that
has one. Rejected: the human hand-edits from scratch — that is v1's `domain-notes.md` shape
exactly, a file that begged in its own header to accumulate and got **two commits in its entire
life**. The tool does the typing; the human keeps the judgement and the commit.

### 9. The model reads its own assist history, deliberately

The contract is read by the model, so the §8 line reaches every later run. Ticket 10 killed
accumulating context — but what it banned was accumulated **model reasoning**, on the grounds
that *"most accumulated reasoning is the reasoning that produced the failure"*. An assist line
is not reasoning. It is a dated fact, and next to it sits the human's annotation, which is
ticket 08's authoring-interview output and is *designed* to be read.

A line reading *"three elements matched `{tag: button, text: 'OK'}`"* is a hazard prior, which
is precisely what ticket 08 wanted assist events to become. So it is read on purpose.

No cap on the list, and no section the model is told to skip. A contract carrying six assist
lines is a scenario that should be rewritten, and the growing list **is** the signal that says
so. **The contract format is unchanged — a fifth consecutive ticket to leave it alone.**

### 10. "The application is wrong" is a first-class answer, and only wording protects it

Condition 7's *proven* variant carries the strongest packet in the design: *"this selector is
correct — the probe just observed it — and the assertion still fails."* Its best outcome is that
v2 found a real regression, the scenario needs no change, and the human files a bug.

That answer lands in no artifact, and it needs none. **v2's job ends at "I found a disagreement
and here is the proof."** Rejected: a *known failure* marker on the contract — it writes a
temporary state into a durable artifact and breaks the format streak §9 just preserved.
Rejected: committing the red spec as a regression test — it breaks the single invariant ticket
09 fought for, *v2 never leaves anything red that is committed*.

But it puts one **wording** requirement on the packet, and it is load-bearing: the packet must
name *"the application is wrong"* as a legitimate answer, in those words. If the human assumes
the tool is broken, the cheapest way to make the packet go away is to weaken a correct Expected
Outcome. Ticket 11's frozen fields stop the **model** doing that. Nothing but the packet's
wording stops the **human**.

### Found by reading

- **The trip-condition tally in `CONTEXT.md` is wrong**, and ticket 11 contradicted it inside
  its own paragraph. Corrected in §1, and re-cut on the axis that actually determines the
  packet.
- **Ticket 09's "the IR does not survive the run" is already false.** Ticket 11 put a *full IR
  snapshot* in every attempt-log entry and ticket 09 keeps every attempt log **in full**, so the
  IR survives — up to six copies of it — as log content. The decision is fine and only the
  sentence is wrong: ticket 09's stated reason was a second *reviewed* artifact drifting when a
  human edits the `.ts`, and a log entry is not reviewed and cannot drift.
- **Ticket 09's "setup writes to the repo, runs do not" was false when it was written.** Its own
  §3 puts the candidate spec **at its final path inside the committed spec tree**, red and
  uncommitted, because 64 of 200 host specs import relatively and leave no choice. Runs have
  always written into the repo. The rule ticket 09 actually defends is the one it states once:
  **v2 never leaves anything red that is committed** — to which this ticket adds *and never runs
  git*.
- **Ticket 08's "the evidence stream costs nothing new" understated the cost.** The attempt log
  lives in `.cygen/runs/<runId>/`, which is gitignored and — by ticket 09's explicit rule for
  the facts cache — per-developer. So it answers none of the three questions the growth rule
  asks: across runs, across contracts, across people. Promotion would have depended on a human
  noticing a local file and hand-carrying it, **which is the exact mechanism that produced two
  commits in `domain-notes.md`'s entire life**. The §8 contract line is the fix: it is one line,
  in a file that is already committed, landing in a diff the human was going to read anyway.

### Corrects, and hands on

- **Corrects `CONTEXT.md`** twice: the trip-condition tally (§1), and the **source map**, which
  it records as *"a build artifact, discarded with the IR"* against ticket 11's requirement that
  it survive an assist. It is kept, in the attempt log (§3).
- **Corrects [Hygiene](09-hygiene.md)** twice: *"the IR does not survive the run"*, and *"setup
  writes to the repo, runs do not"*. Both conclusions stand; both sentences are wrong.
- **Corrects [Scenario authoring](08-scenario-authoring-assist.md)**: the hazard evidence stream
  is not free. It needs the §8 contract line to leave the developer's machine.
- **Satisfies [Heal granularity](11-heal-granularity.md)**'s packet requirement — the source map
  survives an assist alongside the red spec — and adopts its six attempt-log fields whole.
- **Satisfies [Hygiene](09-hygiene.md)**'s packet requirement: the envelope names the spec path
  and says it is uncommitted and red.
- **Sharpens the "cost estimation" fog** a third time. Ticket 09 named the attempt logs as the
  data source; §6 now requires the cumulative per-contract figure to be *computed and shown*,
  which is the first consumer that estimate will ever have.
- **Hands [Conventions scout](06-conventions-scout.md) a retroactive requirement:** the
  conventions file must be **machine-appendable** — §8 writes a proposed entry into it
  unstaged. Its YAML-plus-JSON-Schema shape already permits this; nothing in ticket 06 promised
  it.
- **Leaves [Agent runtime](14-agent-runtime.md) one constraint:** assist is terminal, so no
  runtime shape may assume a long-lived process that outlives a run.

### What this adds

**Zero IR verbs. Zero contract fields** — the format is unchanged for the fifth consecutive
ticket, and §9 declined the one section that would have changed it. **Two attempt-log fields**
(trip condition, source map). **One packet**, which is a rendering and not a stored artifact.
**One wording requirement** (§10). Three commands, none of them in a run's path: render a
packet, apply a proposed conventions entry, summarise local logs for hazard promotion.

### New unvalidated assumptions

- **A prose annotation in the contract is a good enough answer channel.** §4 routed conditions
  2, 3, 5 and 7 through prose rather than a direct row pick, accepting a lossy
  prose → model → selector hop for durability. Never measured; the benchmark has never been run,
  and no human has ever answered an assist. **Reopens §4's destination** for condition 5
  specifically if a re-run *after* an assist trips the same condition again — that is the
  channel failing, and the fallback is a structured annotation naming the observed row.
- **The cumulative cost figure is a sufficient governor.** §6 declined a cap on repeated assists
  on the grounds that a human decides each time, and made the number visible so that decision is
  informed. Unmeasured, and the only alternative it was weighed against is a policy cap with no
  data to set it from. **Reopens the cap** if a contract is ever observed assisting repeatedly
  with the figure in front of the human.
