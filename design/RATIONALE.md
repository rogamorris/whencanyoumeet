# Event modification and reopen

## Problem

PRD §7.2 promises an organizer can edit a poll and reopen it, that constraint changes create a new
event version, that added windows are unknown rather than inherited as yes, and that a duration
change requires re-evaluation. None of that is true today: `eventVersion` is written as 1 and never
moves, no store method rewrites windows, and there is no edge back into `open`.

What makes the shape non-obvious is that availability is not stored per candidate. Participants
paint time ranges; candidates are recomputed from `windows × durationMinutes` on every read, and a
four-state answer is derived geometrically by asking which stored paint fully covers a candidate. An
edit therefore re-projects every existing answer onto a candidate set nobody agreed to. Three
existing facts constrain any design. `effectiveState` turns `unknown` into `unavailable` for anyone
in `remainder_unavailable` mode, so adding a window manufactures firm "no" answers from people who
never saw that time. `candidatesInWindows` throws when no meeting fits, so a poll whose stored
windows and duration disagree is unreadable on *every* surface — the write must be atomic and
pre-validated. And the original `RangeSpec` is never persisted, so there is no recipe to patch;
an edit either supplies absolute windows or re-expands a fresh range.

## Usage (caller's view)

[`USAGE.md`](USAGE.md) is the spec: the invalidation table, an agent widening the offer and then
shortening the meeting over MCP, the JSON API showing the version check both failing and succeeding,
and the organizer form plus the participant's re-confirm path. The types in
[`SHAPE.ts`](SHAPE.ts) are derived from it.

The shortest statement of the contract: one call changes the offer and tells you what it did to the
people who already answered.

```jsonc
{ "eventVersion": 3,
  "impact": { "constraintsChanged": true, "responsesNeedingReevaluation": 4, "responsesNarrowed": 0 },
  "receipt": "Updated the offer. Event version 3. The meeting length changed from 60 to 30 minutes, so all 4 responses answered a different question and count as unknown until those participants answer again. No invitations were sent." }
```

## Shape

**The load-bearing data structure is `EventConstraints = { durationMinutes, windows }` — "the
question this poll asks" — and the decision to store a copy of it on each response.** One type, three
uses: what the poll currently asks, what an edit resolves to, and what a given answer answered.
Everything else falls out.

`ParticipantResponse.answered` carries the constraints in force when the answer was last given, with
two invariants maintained on write and on edit: `answered.windows ⊆ the poll's current windows`, and
every painted interval lies inside `answered.windows`. The first invariant is the whole fix for
`remainder_unavailable`: the remainder a participant declared is the remainder *of what they saw*, so
`effectiveState` promotes `unknown` to `unavailable` only inside `answered.windows`, and newly
offered time is outside it. The second kills orphan paints — the failure mode where a shrink leaves
interval rows that tallies ignore and a re-posting client gets `out_of_range`.

Duration is the other half of `answered`, and it gives re-evaluation for free.
`needsReevaluation(answer, asking)` is one comparison of two stored numbers, derived on every read
rather than stored as a flag, so reverting a duration restores every answer and there is nothing to
un-set. Per single-source-of-truth: derive instead of sync.

All the policy lives in one new module, `src/domain/revision.ts`, exporting exactly one function.
`planRevision(current, responses, patch)` is pure and returns an `EventRevision` containing a
ready-to-execute `EventWrite`, the change classification, the impact, and the receipt prose. The
command is three lines: resolve the token, plan, apply. Two decisions inside it matter more than the
rest. **The effect of an edit is computed from a diff against stored state, not from which fields the
caller sent** — which is what lets the HTML form post every field it renders without invalidating
everyone, and makes a replayed edit a no-op. And **clipping narrows a response's paints and its
answered scope together**, by the same rule, in the same transaction; clipping only the paints would
let a shrink-then-regrow resurrect a remainder as a false "no."

`store.applyEventRevision(write)` is the only transactional method in the store. There is
deliberately no generic `store.transaction(fn)`: a driver transaction handle reaching the domain
would be exactly the leakage the codebase has so far avoided. The guarded `UPDATE ... WHERE
event_version = ? AND status IN (...)` is modelled on `finalizeIfFresh`; zero rows rolls the whole
thing back, so a poll can never land with windows that yield no candidate. `store.setStatusIfIn`
replaces the blind `setStatus`, whose `extra` parameter could write `eventVersion` with no
precondition; `close` and `cancel` adopt it, so every status write in the codebase is either this or
`finalizeIfFresh`, and the store replaces a method rather than adding one. Validation is semantic and lives in the domain; zod at the adapter
edge does shape only, per boundary-discipline.

**The eight decisions.**

1. *Reopen from `closed` only.* `reopen` is the inverse of `close` and nothing else. `cancel` means
   "there is no meeting"; its inverse is a new poll, not a lifecycle edge. This also keeps the "live"
   set at `{open, closed}` — the same set `finalizeIfFresh` already encodes and that edits now use —
   and it is why reopen never has to clear `finalizedStart/End`.
2. *Replace-all windows.* Add/remove primitives would put window identity on the public surface and
   double the number of paths maintaining the candidate-exists invariant.
3. *`eventVersion` bumps only when the candidate set changes* — windows or duration. Title, context,
   location, and a timezone edit that moves no instant do not bump, so the counter stays a precise
   "the question changed" signal rather than a generic dirty bit. Timezone needs no special rule:
   edited with a range it re-expands the windows and the diff bumps; edited alone it moves nothing.
   Every edit still *sends* `eventVersion` as a CAS, because an editor who has not seen the current
   offer should not be editing it.
4. *`remainder_unavailable` and growth:* scoped by `answered.windows`, as above. Their declaration is
   preserved intact for the range they evaluated, and they are not downgraded to `partial`.
5. *Duration change keeps the paints and stops counting them.* Non-destructive, reversible, and it
   cannot inherit a yes across a changed question. The organizer sees a count, not a silent shift.
6. *`submit` and `update` require `eventVersion`.* Making it optional would leave the invariant
   "every stored answer was given against constraints we can name" unverifiable, and it is the only
   thing standing between a mid-edit participant and a silently re-projected answer. `withdraw` does
   not take one: leaving is not an answer.
7. *Edits are allowed while `closed`, and never change status.* "Close, review, widen the offer,
   reopen" is three explicit acts; auto-reopening would re-open collection as a side effect of
   editing. `finalized` and `cancelled` are refused.
8. *Reopen is idempotent on an already-open poll*, mirroring `close`, and bumps nothing — no
   constraint and no result changed, and `finalizeIfFresh` already accepts `open`.

**Interface depth.** The public surface grows by two command methods, one input type, one result
type, four routes, and two MCP tools. Behind it sit constraint resolution across two input forms,
DST-safe range expansion, diff classification, the candidate-exists gate, clipping of paints and
scopes, remainder scoping, staleness derivation, an atomic multi-table write under CAS, and impact
reporting. Callers coordinate nothing and sequence nothing: there is no "clear then set", no preview
step to remember, and no way to apply half an edit. What stays exposed is `eventVersion` (already
public, and PRD §7.3 makes freshness a product concept), the `windows | range` duality (already
exposed by `createPoll`), and the four-state vocabulary. No storage or transport type crosses the
boundary; the JSON encoding of `answered_constraints` is known only to `store.ts`.

**What this deliberately does not do.** No history of past revisions, no per-window identity, no
notification of affected participants, no preview endpoint, and no change to `stateForCandidate`'s
coverage rule.

## Synthesis decision

*Filled in by arena.*

## Tradeoffs accepted

- We accept a denormalized copy of the answered constraints on every response in exchange for
  read-time correctness with no history table, no join on the tally path, and no shared row that two
  actors reason about differently.
- We accept that a duration change blanks every existing answer to `unknown` in exchange for never
  inheriting a yes across a changed question — and unlike wiping, the answers return if the
  organizer reverts.
- We accept breaking the participant submit/update wire shape with a required `eventVersion`, and
  the resulting 409 for someone who filled a form slowly during an edit, in exchange for never
  silently accepting an answer to a question the participant did not see.
- We accept destructive clipping of paints outside a narrowed offer in exchange for the invariant
  that stored paints always fit the current offer, which removes the orphan-paint failure mode
  entirely rather than teaching every reader to tolerate it.
- We accept that a retried edit gets 409 rather than replaying, because extending the
  `Idempotency-Key` machinery past `createPoll` is a larger change than this needs. The CAS already
  guarantees at-most-once application, which is the property that matters.
- We accept that a cancelled poll cannot be recovered, in exchange for `cancelled` keeping a single
  meaning.
- We accept reshaping `effectiveState` and `tallyCandidates` (three call sites in
  `tests/overlap.test.ts`, expectations unchanged) in exchange for the scope being available where
  the decision is made instead of threaded in as a fourth positional parameter.

## Alternatives considered

- **A revisions table** (`poll_revisions` keyed by `eventVersion`, responses storing
  `answeredEventVersion`). Normalized and auditable, and it was the closest contender. It loses on
  interface depth in the wrong direction: it exposes a version-to-constraints lookup that every read
  path must join, while hiding nothing the product consumes — nothing renders history. Worse, the
  scope it yields is shared state: after a shrink-then-regrow the row for version *N* still names
  windows that were withdrawn, and there is no per-response place to clip. Per
  separate-before-serializing-shared-state, the scope belongs to the actor who answered.
- **Materialize the remainder as explicit `unavailable` intervals at write time**, deleting the
  read-time `coverageMode` inference entirely. Tempting, and structurally the purest: `unknown`
  would mean unknown everywhere, and added windows would be unknown by construction with no scope to
  store. It loses because faithfulness requires also changing `stateForCandidate` from
  full-coverage-only to an overlap veto (a candidate straddling the edge of a painted region must
  stay a "no"), which changes the meaning of every existing response — a large blast radius on the
  hottest path to avoid one column.
- **Fork on edit: an edit creates a new poll with a new `publicId` and no responses.** Zero
  invalidation logic, but it makes "edit" indistinguishable from delete-and-recreate, which callers
  can already do, and it kills the invitation link every participant holds.
- **Wipe paints on a duration change.** Simpler reads with no staleness concept, but destructive and
  irreversible, and it discards information the participant may still want to re-affirm with one
  click.
- **Token-only update, mirroring `close`.** A constraint edit is a read-modify-write over state the
  organizer just read; two organizer sessions, or an agent and a human on the same token, would
  clobber each other silently. `finalize` set the precedent for exactly this situation.
- **Lifecycle as an append-only event log with status derived by folding it.** The whole-shape
  alternative the task names. Rejected: status is read on every request, so every read would fold a
  log, and nothing in the product consumes the history that buys.

## Open questions and risks

- Should the public invitation page keep counting a response that needs re-evaluation in
  `respondentCount`? Telling an outsider "5 people responded" when zero have answered the current
  question is arguably the dishonest aggregation the product exists to avoid.
- Is `closed`-only reopen right, or does an organizer who cancelled by mistake need an un-cancel
  path badly enough to justify blurring what `cancelled` means?
- The backfill stamps existing responses with the poll's current constraints, treating everyone as
  up to date. That is accurate today because nothing has ever been edited — is it acceptable to
  depend on that, or should the migration be defensive?
- `bumpResultsVersion` is still a `SELECT` then `UPDATE` and can lose an increment, which silently
  weakens the finalize CAS this design leans on. It is a one-line fix to
  `results_version = results_version + 1`. Do we take it here, or leave the freshness story partly
  aspirational?
- Should a participant whose paints were clipped by a narrowed offer learn about it? There is no
  messaging surface, so today the only signal is their next page load.

## Next implementation step

Write `src/domain/revision.ts` with `planRevision` and `tests/revision.test.ts` covering the five
change classes plus shrink-then-regrow, before touching the store or any adapter.
