# Editing an event, and reopening collection

Two new organizer operations complete PRD §7.2: `update_event` changes what the poll offers, and
`reopen_poll` resumes collection on a poll that was closed without a decision. Both are `POST`,
both are authorized by the organizer token alone, and both are available on every surface
(JSON API, HTML form, WebMCP, MCP over HTTP, MCP over stdio, OpenAPI).

`update_event` is versioned like `finalize`: you send the `eventVersion` you were looking at, and
the edit applies only if nobody moved the offer underneath you. `reopen_poll` is token-only and
idempotent like `close`.

## What an edit does to the answers people already gave

This is the contract. It is the same on every surface, and it is decided in the domain, not by the
caller.

| You change | `eventVersion` | Answers already collected | Newly offered time |
|---|---|---|---|
| Title, context, location | unchanged | untouched | — |
| Timezone, without re-expanding a range | unchanged | untouched | — |
| Add window area | +1 | kept; every answer still means what it meant | **unknown for everyone**, including people who declared their remainder unavailable |
| Remove window area | +1 | kept, narrowed to the times you still offer | — |
| Change the meeting length | +1 | kept in storage, but counted as **unknown** until each participant re-confirms | — |
| Re-post the constraints you already have | unchanged | untouched | — |

Three rules behind that table:

1. **A "no" never spreads.** A participant who said "anything I did not paint is a no" said it about
   the offer they saw. We store the offer they saw with their answer, so newly added time is
   unknown for them, not unavailable.
2. **A different length is a different question.** Changing the duration does not delete anyone's
   paint, it stops counting it. Revert the duration and every answer comes back, because the flag
   is derived, not stored.
3. **Nothing is left behind a shrunk offer.** When you remove window area, paints outside the new
   offer are trimmed to what survives. There are no orphan intervals, so a participant's client can
   always re-post what it read back.

## Call site 1 — an agent over MCP

The organizer's agent notices nobody can make Tuesday and widens the offer.

```jsonc
// tools/call update_event
{
  "organizerToken": "hnR6…",
  "eventVersion": 1,
  "range": {
    "startDate": "2026-09-21",
    "endDate": "2026-09-25",
    "weekdays": [1, 2, 3, 4, 5],
    "dailyStart": "09:00",
    "dailyEnd": "17:00"
  }
}
```

```jsonc
// result
{
  "eventVersion": 2,
  "impact": {
    "constraintsChanged": true,
    "candidatesBefore": 20,
    "candidatesAfter": 145,
    "responsesNeedingReevaluation": 0,
    "responsesNarrowed": 0
  },
  "receipt": "Updated the offer. Event version 2. 4 responses kept their answers; the time you added is unknown for everyone until they answer it. No invitations were sent."
}
```

The agent does not have to re-read the poll to learn what it did to the respondents. One call
returns the new version and who is affected.

Then, later, the organizer's agent shortens the meeting:

```jsonc
// tools/call update_event
{ "organizerToken": "hnR6…", "eventVersion": 2, "durationMinutes": 30 }
```

```jsonc
{
  "eventVersion": 3,
  "impact": {
    "constraintsChanged": true,
    "candidatesBefore": 145,
    "candidatesAfter": 155,
    "responsesNeedingReevaluation": 4,
    "responsesNarrowed": 0
  },
  "receipt": "Updated the offer. Event version 3. The meeting length changed from 60 to 30 minutes, so all 4 responses answered a different question and count as unknown until those participants answer again. No invitations were sent."
}
```

An agent that then calls `get_event` with the organizer token sees `needsReevaluation: true` on each
of those four participants and `unknown: 4` across the tallies. It cannot accidentally read a
"everyone is free" out of answers given for a different meeting.

## Call site 2 — JSON API, with the version check doing its job

```bash
# Two organizer sessions, same token. The second one is stale.
curl -sX POST "$BASE/api/organizer/$TOKEN/update" \
  -H 'content-type: application/json' \
  -d '{"eventVersion":2,"windows":[{"start":"2026-09-22T13:00:00Z","end":"2026-09-22T18:00:00Z"}]}'
# 200 {"eventVersion":3, …}

curl -sX POST "$BASE/api/organizer/$TOKEN/update" \
  -H 'content-type: application/json' \
  -d '{"eventVersion":2,"title":"Q4 planning"}'
# 409 {"error":{"code":"stale_version","message":"The offer changed since you loaded it. Reload the organizer page and edit again."}}
```

A metadata-only edit still has to prove freshness, because the editor could not have known the
windows moved. It does not *advance* the version:

```bash
curl -sX POST "$BASE/api/organizer/$TOKEN/update" \
  -H 'content-type: application/json' -d '{"eventVersion":3,"title":"Q4 planning"}'
# 200 {"eventVersion":3,"impact":{"constraintsChanged":false, …},
#      "receipt":"Updated the event details. The offered times and meeting length are unchanged, so nobody needs to answer again."}
```

Reopening, and the shape of its idempotency:

```bash
curl -sX POST "$BASE/api/organizer/$TOKEN/reopen"   # closed → open
# 200 {"receipt":"Collection reopened. Participants can answer again."}
curl -sX POST "$BASE/api/organizer/$TOKEN/reopen"   # already open
# 200 {"receipt":"Collection reopened. Participants can answer again."}
```

Reopen refuses everything else, and says which wall it hit:

```bash
# finalized
# 409 {"error":{"code":"closed","message":"A finalized poll is not reopened. Edit the times or delete it and start again."}}
# cancelled
# 409 {"error":{"code":"closed","message":"A cancelled poll is not reopened. Create a new poll."}}
```

## Call site 3 — the organizer page, and what a participant sees

`OrganizerPage` grows one card and one button. The edit form posts every field it renders; that is
safe because the effect of an edit is computed from a diff against stored state, not from which
fields were present.

```tsx
<form method="post" action={`/o/${organizerToken}/update`}>
  <input type="hidden" name="eventVersion" value={String(event.eventVersion)} />
  <input name="title" value={event.title} />
  <select name="durationMinutes">…</select>
  <input name="timezone" value={event.timezone} />
  {/* same weekday-range editor as CreatePage */}
  <button type="submit">Update the offer</button>
</form>

{event.status === "closed" ? (
  <form method="post" action={`/o/${organizerToken}/reopen`}>
    <button type="submit">Reopen collection</button>
  </form>
) : null}
```

On the participant side, `submit_availability` and `update_availability` now **require**
`eventVersion`. The invitation and response pages carry it as a hidden input, WebMCP descriptors
declare it, and the MCP tools take it:

```jsonc
// tools/call submit_availability
{
  "publicId": "k3m9…",
  "eventVersion": 3,
  "name": "Ada",
  "intervals": [{ "start": "2026-09-22T13:00:00Z", "end": "2026-09-22T15:00:00Z", "state": "available" }],
  "remainderUnavailable": true
}
```

If the organizer edited between page load and submit, the answer is rejected rather than quietly
re-projected onto constraints the participant never saw:

```jsonc
// 409
{ "error": { "code": "stale_version",
             "message": "The organizer changed the offered times. Reload this page and answer again." } }
```

A participant whose stored answer is out of date reads it on their own page, too:
`getParticipantEvent` returns `needsReevaluation: true`, and the page says the meeting length
changed and asks them to confirm. Re-posting the same intervals against the current `eventVersion`
is the act of re-evaluating; it clears the flag.

## Errors

| Situation | code | HTTP |
|---|---|---|
| `eventVersion` does not match the stored poll (edit, submit, update) | `stale_version` | 409 |
| Edit or reopen on a `finalized` or `cancelled` poll | `closed` | 409 |
| Edit leaves no full-duration candidate, or exceeds the 60-day horizon | `validation` | 400 |
| Edit supplies both `windows` and `range` | `validation` | 400 |
| Unknown organizer token | `not_found` | 404 |

Reopen on an already-open poll is not an error; it returns the same receipt as the transition.
