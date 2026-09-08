# Deliverable assembly: the design record's structure and location

Type: grilling
Status: resolved
Blocked by: —
Assignee: jdre

## Question

Graduated from fog by [Agent runtime](14-agent-runtime.md), which was the last open
architectural ticket. Every load-bearing decision is now locked, so the map's destination —
*"a reviewed design spec for c8y-cygen v2, committed on `c8y-e2e-generation-agents-2` … ready to
hand to a separate implementation effort"* — is all that remains, and it is now sharp enough to
ticket.

This is the one remaining decision, and it is not architectural. It is: **what does the
hand-off artifact look like, and how does it stay true?**

- **Structure.** Fifteen ticket resolutions hold the design, and they are *arguments* — each
  carries its question, its rejected options, what it corrected, and what would reopen it. A
  spec for an implementer wants the *conclusions*, organised by the thing being built
  (IR and schema, compiler with two back-ends, ladder, loop and budget, conventions scout,
  assist, hygiene, runtime) rather than by the order the questions were asked. Is the spec a
  rewrite, a curated index over the tickets, or both — a short normative document plus the
  tickets as cited rationale?
- **What happens to the reasoning.** The tickets are the only record of *why*, including the
  corrections tickets made to each other (ticket 14 alone corrects four). A spec that drops
  that invites an implementer to re-open settled ground; a spec that keeps all of it is 15
  documents long and nobody reads it. Where does the argument live?
- **The unvalidated assumptions are the most important section and have no natural home.**
  There are now eleven, each with a named reopening trigger, and the benchmark has never been
  run — so the spec is a design whose load-bearing numbers are *all* unmeasured. That has to be
  stated where an implementer cannot miss it, not in an appendix.
- **Location and format.** In-repo markdown on `c8y-e2e-generation-agents-2`, beside the
  `.scratch/c8y-cygen-v2/` material that produced it? A single file or a directory? The map,
  `CONTEXT.md` (the ubiquitous language) and `benchmark/` already exist and are referenced by
  every ticket — does the spec absorb them, cite them, or supersede them?
- **What the implementer is handed first.** Ticket 01's benchmark is the acceptance contract and
  ticket 10's loop is the skeleton; the order the spec introduces things determines whether the
  design reads as motivated or as arbitrary.
- **Provenance.** The spec is a planning artifact for an implementation effort that will be a
  *separate* map. What does it owe that effort — a definition of done, the pre-registered
  tripwires, the first thing to measure?

Not in scope: writing the implementation, or re-litigating any resolved ticket. If assembling
the spec surfaces a genuine contradiction between two resolutions, that is a new ticket, not a
scope extension of this one.

Run `/grilling` and `/domain-modeling` per the map's Notes.

## Answer

**The deliverable is a *design record*: nine normative files behind one front door, in
`packages/c8y-cygen/`, written for the sessions of the next map rather than for a single
human reading once. The fifteen tickets stay byte-for-byte as the argument, and one
corrections list carries the drift between them.**

### 0. A word collision, fixed first

`CONTEXT.md` already owns **spec**: it is the house-style Cypress file that spec mode emits
into the target repo. This ticket's own title used the same word for the hand-off document.
Two meanings for one word in a design about generating specs is a defect waiting to happen.

The hand-off artifact is the **design record**. Added to `CONTEXT.md`.

### 1. The reader is a session, not a person

The destination says the design is handed "to a separate implementation effort". That effort
will be a wayfinder map, like this one. So the record's reader is an agent session that loads a
small standing block every time and opens exactly one further file for the ticket in hand.

This is the decision that sizes everything else. A single document read start-to-finish would be
optimised for a reading that happens once; the standing block is read every session for the life
of the implementation. Optimise the thing that is read repeatedly.

A human reviewer still reads it end to end — the destination requires the record be *reviewed* —
but no part of it is written only for that reading.

### 2. Nine files, cut by the thing being built

The tickets are sorted by the order the questions were asked. A builder needs them sorted by the
part being built. Nine parts, and the loop comes first because it is the skeleton every other
part hangs from:

```
packages/c8y-cygen/
  DESIGN.md              front door: Given, invariants, tripwires,
                         measure-first, index.  ~120 lines
  design/
    01-loop.md           one loop, one artifact, budget, stop condition
    02-ir.md             the IR, its schema, the closed vocabularies
    03-compiler.md       spec mode and probe mode
    04-ladder.md         candidate table, rungs, cardinality, demotion
    05-conventions.md    the scout, the conventions file, the reach index
    06-authoring.md      the scenario contract and the authoring interview
    07-assist.md         trip conditions, evidence tiers, the attempt log
    08-hygiene.md        working area, output path, run manifest, sweep
    09-runtime.md        model, cache breakpoints, tool surface
    corrections.md       the list from §3
```

Each file states the rules, then links the tickets that argued them. The record cites
`benchmark/README.md` and `CONTEXT.md`; it absorbs neither. A glossary that grows a design
section stops being a glossary, and the acceptance contract must be readable without the design.

**Rejected: the near-free option.** The map's Decisions-so-far is already a curated index over
all fifteen tickets, and re-sorting it by part would cost almost nothing. It is the raw material,
not the answer — a gist is written to let a reader *judge relevance*, and a builder needs the
rule itself.

### 3. The arguments stay as written

Five tickets correct earlier ones. Ticket 02 still bans `cy.c8yclient`, which ticket 15
overturned; ticket 02 still names `visitAndWaitToFinishLoading`, which ticket 06 proved does not
exist. Only the map records either. Cite the tickets as rationale and a reader lands on false
text and believes it.

**No ticket is edited.** Editing them makes the record lie about when we knew what, and the
corrections are the most valuable thing the tickets hold. Instead: one line in every ticket
header saying it is a dated argument and pointing at `corrections.md`.

**The list holds two of the three kinds of correction.** A ticket correcting another ticket
(ticket 15 -> ticket 02) and a ticket correcting a charting premise (**Two genres** overturning the
charted genre scope) both leave stale text in a file the reader may open. A ticket correcting
*its own* premise or first answer — ticket 14 twice, ticket 09's reversal, ticket 11's mechanics
zone — leaves nothing stale: that ticket's own text already states its final answer. Excluded.

**Sorted by the corrected ticket**, because the reader who needs the list is the reader who just
followed a link into that ticket and saw its header line.

### 4. The eleven split in two, and the next effort owns both

They are not one kind of thing. Three are measurements a person performs: the
4-bytes-per-token conversion, the Cypress run start-to-start gap, the per-iteration output token
count. Eight are tripwires — *reopen decision X if result Y is observed*.

A measurement is work and belongs in a backlog. A tripwire is a condition and belongs where it is
seen every session. Put one in a backlog and it gets ticked done and stops being watched.

So: **"Measure first"** goes to the implementation map as its opening backlog. **"Tripwires"**
goes in the standing block beside the invariants. The design is a design whose load-bearing
numbers are all unmeasured, and handing the measurements over as *work* is the only form of that
statement an implementer cannot skim past.

### 5. What every session loads

`DESIGN.md`'s top is what the next map copies into its **Notes**. It is not a summary of the
design — the nine files are the summary. It holds only what a session must not break whatever
part it is working on:

- **The Given.** The ten premises settled during charting and held by no ticket: packaging as
  `packages/c8y-cygen/`, the two target repos, a deployed app as precondition, "green means green
  without retries", the ranked success axes, team adoption as the audience. Lose these and the
  record distils fifteen tickets into a design with no ground under it.
- **The cross-cutting invariants**, about six: no Expected Outcome may be satisfied by a value
  tracing to a `stub` in the same `it()`; the IR holds no raw TypeScript; the model never writes a
  selector; every fabricated body is anchored; setup moves come from a closed per-repo vocabulary;
  a patch may not reach a frozen field.
- **The tripwires** from §4.
- **The index.**

Target 60 lines for the copied part, the same size as this map's Notes.

### 6. What the record owes the next effort, and what it does not

Four things: the standing block, the tripwires, the measure-first backlog, and the definition of
done — which is `benchmark/README.md`, cited, not restated.

**The first measurement is the free one.** `messages.countTokens` against a real assembled prompt
needs no tool, costs nothing, and repairs every cost figure in the design at once — ticket 14
believes its own conversion is ~30% low. Then score B0 with the thinnest slice that can run it,
because B0 is the mandated regression floor and ticket 15 proved B0 does not pass today.

**Not a v1 baseline.** Making v1 run five oracles is real work spent on a tool the map already
ruled reference-only with the burden of proof reversed. An uninterpretable first v2 number is
cheaper than a v1 number nobody will build on.

**The record does not propose the next map's tickets.** It hands over premises and work, and the
next effort charts itself. Pre-slicing fog we cannot see is the one thing wayfinder's own method
forbids.

### 7. Who writes it

Not this session. This session read the map — the gists — and not the 4,400 lines of ticket
bodies. A design record distilled from gists loses exactly the precision it exists to carry.

Nor nine parallel sessions, one per file. Ticket 14 corrects ticket 09, ticket 15 corrects ticket
02, ticket 08 corrects ticket 07; nine independent writers cannot keep those links straight, and
the corrections list is the deliverable's hardest part.

**One writing session, reading the tickets in full.** Two if it runs long.

### Corrects, and hands on

- **Retires `map.md` in place.** It stays in `.scratch/c8y-cygen-v2/`, marked complete, and is
  not edited again after the record is written. The design record links to it once, as the effort's
  own history.
- **Moves one out-of-scope item into the record as a requirement.** "The API-contract / pact
  roundtrip genre" is not only a scope note: ticket 05 decided v2 **refuses** it, at lint time, on
  IR shape. A refusal is behaviour a builder implements. The other three out-of-scope items stay in
  the map as scope history.
- **Closes the map's last fog.** "Cost estimation" never graduated in fifteen tickets because it
  needs a baseline, and this map's frontier is now closed, so it cannot graduate here. Ruled **out
  of scope** and handed to the implementation effort, where the data to decide it will first exist.
- **Corrects `CONTEXT.md` by addition, not by change:** **design record** enters the glossary, and
  **spec** keeps its existing single meaning.
- **A hygiene hazard for the writing session:** `packages/c8y-cygen/` already exists on disk,
  untracked, holding `node_modules/` and a `.env` left over from v1. A `git add -A` in that
  directory commits a secret. Add the `.gitignore` lines before the first file lands.

### What this adds

**Zero IR verbs, zero contract fields** — a seventh consecutive ticket to leave the contract
format alone — and **zero attempt-log fields**, breaking the run of three tickets that grew the
design's fastest-growing artifact. Nothing here touches the tool. It adds **one glossary term**
(design record), **eleven files**, and **one header line per ticket**.

### New unvalidated assumptions

- **Sixty lines is enough standing context to keep a session inside the invariants.** The whole
  progressive-disclosure choice rests on it, and no implementation session has ever run. Measured
  only by analogy: this map's own 40-line Notes held fifteen sessions without one re-litigating a
  charting premise. **Reopens the block's size** — upward, and toward folding a part's invariants
  into its own file — if an implementation session is observed breaking a cross-cutting invariant
  that the block states.
- **A header line is enough to send a reader to the corrections list.** One line of prose is the
  entire mechanism protecting a reader from ticket 02's two false statements. **Reopens §3** — in
  favour of amending the corrected tickets in place — if a session is ever observed acting on a
  superseded statement.
