## Problem

The organizer can close, finalize, cancel, and delete, but cannot change the question or reopen collection. `eventVersion` is stored at 1. Every event payload shows it. `finalizeIfFresh` checks it. Nothing increments it. Availability is painted ranges, not votes on candidate ids. A naive window replace silently re-projects old paints. `remainder_unavailable` then marks a brand-new window as a firm no. A shorter duration inherits yes from geometric cover. A longer duration treats HTML-sized paints and wide API paints differently. Reads call `candidatesInWindows` and throw if nothing fits. A non-atomic delete-then-insert of windows can make every GET return 400. The design has to make PRD 7.2 true without a second product next to `createCommands`.

## Usage (caller's view)

Callers import `updateEvent` and `reopen` from `createCommands`. Organizer JSON posts `POST /api/organizer/:token/update` and `POST /api/organizer/:token/reopen`. HTML posts the same verbs under `/o/:token/...` and 303s back. MCP and WebMCP expose `update_event` and `reopen_poll`. Stdio proxies those JSON routes so `remoteCommands satisfies Commands` still typechecks.

`updateEvent` takes the organizer token, the `eventVersion` the client last read, and any subset of title, context, location, timezone, duration, `windows`, or `range`. It returns the new versions, a receipt, and `invalidatedAnswers`. `reopen` takes only the token and returns a receipt.

Participants send `eventVersion` on submit and update. After an organizer adds a window, a `remainder_unavailable` respondent stays `unknown` on the new slots until they submit again. After a duration change they get empty intervals and `needsReevaluation: true`. See `USAGE.md` for the three call sites.

## Shape

The load-bearing type is `EvaluatedScope`. A paint is an answer about a horizon, not about whatever windows exist later. `remainder_unavailable` means "I judged the remainder of what I saw." That fact is stored on the participant as `evaluated_windows`. On read, `effectiveState` takes a required `EvaluatedScope`. A candidate outside the horizon is `unknown`. `{ kind: "none" }` is the duration-wipe state and makes every candidate unknown.

This is the structure the current code was missing. Today's `effectiveState(intervals, candidate, coverageMode)` cannot tell an added window from an unpainted slot inside the original offer. Adding a boolean `stale` would need to stay in sync with coverage and still would not keep remainder honest on the old windows. A sum type deletes that pair of flags. Model the domain.

`ConstraintDiff` and `InvalidationPlan` are the other two types. Commands merge the patch into an `EventSnapshot` the same way `createPoll` resolves `windows` or `range`. `diffConstraints` compares canonical instants and duration only. `planInvalidation` is the named policy function. Adapters never see it.

A window-only change bumps `eventVersion` and `resultsVersion`, replaces the window rows, backfills null scopes to the previous windows, and deletes interval rows that no longer sit inside a window. Coverage and remaining paints stay. A duration change, alone or with windows, wipes paints, sets coverage to `partial`, writes `evaluated_windows` as `[]`, bumps both versions, and bumps each `responseVersion` so an in-flight participant update 409s. Metadata, including timezone with no new windows and no range, writes the poll row and leaves versions alone.

`eventVersion` is a candidate-set version. A title fix must not invalidate participant writes or force a new Choose. The HTML edit form always posts the full window list, so presence of the field is not the signal. `windowsEqual` after `canonicalWindows` is. Timezone plus `range` re-expands instants, so that write is a window change.

Validation sits at two boundaries. Zod parses HTTP and MCP bodies. `mergeEventSnapshot`, `assertDuration`, `assertTimeZone`, and `candidatesInWindows` run inside the command before any write. `applyEventEditIfFresh` runs one drizzle transaction with `WHERE event_version = ? AND status IN ('open', 'closed')`. `setStatus` is not used. The store applies a plan it did not invent. Boundary discipline.

Reopen is `UPDATE ... status = 'open' WHERE status IN ('closed', 'cancelled')`. Already open returns the close-style receipt and writes nothing. Finalized throws `closed`. Versions do not move. Make operations idempotent.

Submit and update require `eventVersion`. That is how `eventVersion` becomes real on the participant side. A cached agent POST cannot declare remainder against a question it has not seen. Encode the lesson in the input type, not in a comment. Withdraw stays token plus `responseVersion` because leaving is not a claim about the current candidates.

Edit is allowed on `open` and `closed` and does not change status. Close means "stop collecting." It is not "freeze the question." Auto-reopen would mix two operations and let people answer while the organizer is still reshaping windows. Cancelled polls are not editable. Reopen first, then edit.

The methods callers import are `updateEvent` and `reopen`. They hide constraint diff, invalidation, horizon backfill, the transaction, version bumps, and candidate validation. Callers still choose field values and send `eventVersion` for the lost-update check. That is as small as the job gets. Adding `planInvalidation` to Commands, or a `lifecycle.ts` that forwards the same arguments, would be a pass-through. The call chain is adapter, `commands.ts`, then `overlap.ts` plus `store.ts`. Three files.

`ParticipantPage` must call `remapPaintedAnswers`. The current string compare on ISO text is a known bug for API-formatted paints and must not become the edit remap path.

Screened against the design red flags. The module is deep because the policy is behind two methods. Transport types stay in zod and OpenAPI. Stages are not public modules. Store methods add a precondition and a transaction, not a rename of `setStatus`.

## Synthesis decision

Arena fills this section after it compares candidates.

## Tradeoffs accepted

- We accept a nullable `evaluated_windows` column and a first-edit backfill in exchange for remainder staying true on the original windows after growth.
- We accept a breaking `eventVersion` field on submit and update in exchange for refusing silent re-projection. This product is still the first slice. Old clients must GET again.
- We accept last-write-wins on concurrent metadata edits that share the same `eventVersion` in exchange for not turning a typo fix into a new question.
- We accept 409 on a double-clicked constraint save in exchange for one compare-and-swap rule shared with finalize. There is no `Idempotency-Key` on update.
- We accept wiping duration-changed paints instead of parking them in exchange for a duration revert that cannot resurrect an old answer.
- We accept replace-all windows, with no stored `RangeSpec` and no window ids, in exchange for one write path shared with create.
- We accept JSON text for the horizon instead of a version-history table in exchange for keeping reads on the current `windows` rows plus one participant column.
- We accept reopen from `cancelled` in exchange for not forcing the organizer to recreate a poll and lose every answer after a mistaken cancel.

## Alternatives considered

**Downgrade `remainder_unavailable` to `partial` on window growth.** Callers would see a smaller Commands object and no schema change. They would also lose a legitimate remainder claim on the windows the person did evaluate. Added windows would be unknown, but the old remainder would vanish. Hidden complexity is low. Exposed cost is a lying tally on the original slots. Rejected.

**Keep paints on duration change and rely on geometric `covers`.** The public methods stay the same size. The lie moves into `effectiveState`. Duration-down inherits yes. Duration-up depends on whether the client sent HTML-sized slots or one wide API range. PRD 7.2 says duration is a new question. Rejected.

**`evaluatedEventVersion` plus a `poll_window_versions` history.** Reads would reconstruct the horizon from a version table. That hides the same policy, then adds a history join to every tally. Participants already own the paints. They can own the horizon they painted against. Rejected as more machinery for the same fact.

**Add-window and remove-window commands, or window ids.** Callers would orchestrate several writes to express one new offer. Windows have no identity today and `RangeSpec` is discarded at create. Replace-all is the create path. A richer organizer API here is a shallower module. Rejected.

**Token-only `updateEvent`, like `close`.** The caller would send no `eventVersion`. Two organizer tabs could overwrite each other, and `finalizeIfFresh` would be the first place a lost constraint update showed up. Finalize already taught the versioned-body pattern. Rejected.

**Bump `eventVersion` on every save, including title.** Simpler increment rule. Every typo would 409 in-flight participant submits and Choose forms. `eventVersion` would stop meaning "the candidates changed." Rejected.

**Optional `eventVersion` on submit, or none.** Adapters stay compatible. Stale remainder POSTs become claims about windows the person never loaded. The column would keep being a finalize-only promise. Rejected.

**Auto-reopen when a closed poll is edited.** One call would collect answers again. An organizer shaping windows after a deadline would reopen by accident. Close and reopen stay two operations. Rejected.

**Reopen from `closed` only.** Sharper state machine. A mistaken cancel then has no inverse except delete or a new poll, and cancel does not delete rows. Reopen from cancelled is the inverse of cancel. Finalize stays the only terminal live state. Rejected the closed-only rule.

**`lifecycle.ts` as a transition table.** It would list edges, then call `setStatus` or the new store methods. The invalidation knowledge would still live elsewhere, so the file would not remove branches. It would add a hop. Rejected.

## Open questions and risks

- Should the first production migrate backfill `evaluated_windows` from current window rows, or is the lazy write inside `applyEventEditIfFresh` enough for existing PGlite data directories?
- After a duration wipe, should the participant HTML show the old paints as an unsubmitted hint, or stay empty so re-evaluation is visible?
- `bumpResultsVersion` on ordinary submit is still a non-transactional read-modify-write. Do we fold that path into the same transaction helper once `applyEventEditIfFresh` exists?

## Next implementation step

Add `EvaluatedScope`, `diffConstraints`, `planInvalidation`, and `applyEventEditIfFresh`, then implement `updateEvent` against those four before any adapter route.
