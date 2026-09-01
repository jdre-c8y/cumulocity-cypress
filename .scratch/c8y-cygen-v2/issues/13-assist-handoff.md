# Autonomy handoff: the assist packet and the way back in

Type: grilling
Status: open
Blocked by: —

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
