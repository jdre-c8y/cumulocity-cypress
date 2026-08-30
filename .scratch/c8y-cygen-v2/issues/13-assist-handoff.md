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
