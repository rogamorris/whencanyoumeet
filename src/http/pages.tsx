import { raw } from "hono/html";
import type { FC, PropsWithChildren } from "hono/jsx";
import { Temporal } from "temporal-polyfill";
import { remapPaintedAnswers } from "../domain/overlap.ts";
import { instantToDate, iso, parseInstant, formatLocal, assertTimeZone, zonedLocal } from "../domain/time.ts";
import type { Candidate, Interval, OrganizerEvent, PublicEvent, ParticipantView } from "../domain/types.ts";
import { DomainError } from "../domain/errors.ts";
import { webmcpScript } from "./webmcp.ts";

export type DateRangeDefaults = {
  startDate: string;
  endDate: string;
  minDate: string;
  maxDate: string;
};

const css = `
  :root { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; background: #f6f4ef; }
  body { margin: 0; }
  main { max-width: 52rem; margin: 0 auto; padding: 1.5rem; }
  h1, h2 { line-height: 1.2; }
  a { color: #0b4; }
  .card { background: #fff; border: 1px solid #ddd; padding: 1rem 1.25rem; margin: 1rem 0; }
  label, .field { display: block; margin: 0.6rem 0; }
  input, select, textarea { font: inherit; padding: 0.35rem 0.5rem; }
  button, .btn { font: inherit; padding: 0.45rem 0.8rem; background: #111; color: #fff; border: 0; cursor: pointer; display: inline-block; text-decoration: none; }
  button.secondary { background: #666; }
  .warn { background: #fff3cd; border: 1px solid #e0c36a; padding: 0.8rem; }
  .muted { color: #555; font-size: 0.95rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; border-bottom: 1px solid #eee; padding: 0.35rem 0.4rem; vertical-align: top; }
  .day { margin-top: 1.25rem; }
  .secret { word-break: break-all; font-family: ui-monospace, monospace; }
`;

export const Layout: FC<
  PropsWithChildren<{ title: string; noReferrer?: boolean; script?: string }>
> = (props) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {props.noReferrer ? <meta name="referrer" content="no-referrer" /> : null}
      <title>{props.title}</title>
      <style>{css}</style>
    </head>
    <body>
      <main>
        <p class="muted">
          <a href="/">When Can You Meet</a>
        </p>
        {props.children}
      </main>
      {props.script ? raw(`<script>${props.script}</script>`) : null}
    </body>
  </html>
);

export function CreatePage(props: { timezone: string; range: DateRangeDefaults }) {
  return (
    <Layout title="When Can You Meet">
      <h1>Find a time</h1>
      <p>
        Create a poll. Share one public link. People or their agents answer. You choose a time. This
        service never reads calendars and does not send invitations.
      </p>
      <form method="post" action="/polls" class="card" id="create-poll">
        <label>
          Title
          <br />
          <input id="title" name="title" required maxlength={200} style="width:100%" />
        </label>
        <label>
          Duration (minutes)
          <br />
          <input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={15}
            max={240}
            step={15}
            value={60}
          />
        </label>
        <label>
          Time zone
          <br />
          <input id="timezone" name="timezone" value={props.timezone} required />
        </label>
        <label>
          First date (YYYY-MM-DD)
          <br />
          <input
            id="startDate"
            name="startDate"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            spellcheck={false}
            pattern="\d{4}-\d{2}-\d{2}"
            placeholder="YYYY-MM-DD"
            title="YYYY-MM-DD"
            min={props.range.minDate}
            max={props.range.maxDate}
            value={props.range.startDate}
            required
          />
        </label>
        <label>
          Last date (YYYY-MM-DD)
          <br />
          <input
            id="endDate"
            name="endDate"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            spellcheck={false}
            pattern="\d{4}-\d{2}-\d{2}"
            placeholder="YYYY-MM-DD"
            title="YYYY-MM-DD"
            min={props.range.minDate}
            max={props.range.maxDate}
            value={props.range.endDate}
            required
          />
        </label>
        <p class="muted">
          Prefills the next five weekdays: {props.range.startDate} through {props.range.endDate}.
          Use ISO calendar dates.
        </p>
        <fieldset>
          <legend>Weekdays</legend>
          {weekdayBoxes()}
        </fieldset>
        <label>
          Daily start (HH:mm)
          <br />
          <input
            id="dailyStart"
            name="dailyStart"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            spellcheck={false}
            pattern="\d{2}:\d{2}"
            placeholder="HH:mm"
            title="HH:mm 24-hour time"
            value="09:00"
            required
          />
        </label>
        <label>
          Daily end (HH:mm)
          <br />
          <input
            id="dailyEnd"
            name="dailyEnd"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            spellcheck={false}
            pattern="\d{2}:\d{2}"
            placeholder="HH:mm"
            title="HH:mm 24-hour time"
            value="18:00"
            required
          />
        </label>
        <label>
          Optional context
          <br />
          <textarea id="context" name="context" rows={2} style="width:100%"></textarea>
        </label>
        <button id="create-submit" type="submit">Create poll</button>
      </form>
      <p class="muted">
        Agents: <a href="/llms.txt">llms.txt</a>, <a href="/openapi.json">OpenAPI</a>, MCP at{" "}
        <code>/mcp</code>.
      </p>
    </Layout>
  );
}

function weekdayBoxes() {
  const days = [
    [1, "Mon"],
    [2, "Tue"],
    [3, "Wed"],
    [4, "Thu"],
    [5, "Fri"],
    [6, "Sat"],
    [7, "Sun"],
  ] as const;
  return days.map(([value, label]) => (
    <label style="display:inline-block;margin-right:0.8rem">
      <input type="checkbox" name="weekday" value={String(value)} checked={value <= 5} /> {label}
    </label>
  ));
}

export function InvitationPage(props: { event: PublicEvent; displayTimeZone: string }) {
  const groups = groupCandidates(props.displayTimeZone, props.event.candidates);
  return (
    <Layout
      title={props.event.title}
      script={webmcpScript([
        {
          name: "get_event",
          description: "Return this poll's constraints, duration, time zone, and lifecycle state.",
          method: "GET",
          path: `/api/polls/${props.event.publicId}`,
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "submit_availability",
          description:
            "Atomically submit Available/Tentative/Unavailable intervals. Unspecified times stay unknown unless remainderUnavailable is true.",
          method: "POST",
          path: `/api/polls/${props.event.publicId}/responses`,
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              eventVersion: { type: "integer" },
              remainderUnavailable: { type: "boolean" },
              intervals: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    start: { type: "string" },
                    end: { type: "string" },
                    state: { type: "string", enum: ["available", "tentative", "unavailable"] },
                  },
                  required: ["start", "end", "state"],
                },
              },
            },
            required: ["name", "eventVersion"],
          },
        },
      ])}
    >
      <h1>{props.event.title}</h1>
      <p>
        {props.event.durationMinutes}-minute meeting. Times shown in {props.displayTimeZone}. Authored
        in {props.event.timezone}.
      </p>
      {props.event.context ? <p>{props.event.context}</p> : null}
      <p class="muted">{props.event.disclosure}</p>
      {props.event.status !== "open" ? (
        <p class="warn">This poll is {props.event.status}. New answers are not accepted.</p>
      ) : null}
      {props.event.finalized ? (
        <div class="card">
          <p>
            Chosen time: {formatLocal(props.displayTimeZone, props.event.finalized.start)} –{" "}
            {formatLocal(props.displayTimeZone, props.event.finalized.end)}
          </p>
          <p class="muted">A downloadable calendar file is not a delivered invitation.</p>
        </div>
      ) : null}
      <form method="get">
        <label>
          Display time zone{" "}
          <input name="tz" value={props.displayTimeZone} />
        </label>
        <button class="secondary" type="submit">
          Update display
        </button>
      </form>
      {props.event.status === "open" ? (
        <form method="post" action={`/p/${props.event.publicId}/responses`} class="card">
          <input type="hidden" name="eventVersion" value={String(props.event.eventVersion)} />
          <label>
            Your name
            <br />
            <input id="respondent-name" name="name" required maxlength={80} />
          </label>
          {groups.map(([day, slots]) => (
            <section class="day">
              <h2>{day}</h2>
              <table>
                <thead>
                  <tr>
                    <th>Start</th>
                    <th>Answer</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr>
                      <td>{formatLocal(props.displayTimeZone, slot.start)}</td>
                      <td>
                        <select name={`slot:${slot.start}|${slot.end}`}>
                          <option value="">Unknown</option>
                          <option value="available">Available</option>
                          <option value="tentative">Tentative</option>
                          <option value="unavailable">Unavailable</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <label>
            <input type="checkbox" name="remainderUnavailable" value="true" /> Mark every unmarked
            slot as unavailable
          </label>
          <p class="muted">Unselected times stay unknown unless you check that box.</p>
          <button id="submit-availability" type="submit">Submit availability</button>
        </form>
      ) : null}
    </Layout>
  );
}

export function ParticipantPage(props: {
  event: ParticipantView;
  responseToken: string;
  displayTimeZone: string;
}) {
  const groups = groupCandidates(props.displayTimeZone, props.event.candidates);
  const current = remapPaintedAnswers(props.event.intervals, props.event.candidates);
  const path = `/api/responses/${props.responseToken}`;
  return (
    <Layout
      title={`Your response · ${props.event.title}`}
      noReferrer
      script={webmcpScript([
        {
          name: "get_event",
          description: "Return this poll plus the current participant response.",
          method: "GET",
          path,
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "update_availability",
          description: "Revise this response with version checking.",
          method: "PATCH",
          path,
          inputSchema: {
            type: "object",
            properties: {
              responseVersion: { type: "integer" },
              eventVersion: { type: "integer" },
              remainderUnavailable: { type: "boolean" },
              intervals: { type: "array" },
            },
            required: ["responseVersion", "eventVersion"],
          },
        },
        {
          name: "withdraw_response",
          description: "Withdraw this response.",
          method: "POST",
          path: `${path}/withdraw`,
          inputSchema: {
            type: "object",
            properties: { responseVersion: { type: "integer" } },
            required: ["responseVersion"],
          },
        },
      ])}
    >
      <h1>{props.event.title}</h1>
      <div class="warn">
        This response URL is a private capability. A display name cannot recover it. Bookmark it.
      </div>
      <p>
        Editing as {props.event.displayName}. Response version {props.event.responseVersion}.
      </p>
      {props.event.withdrawn ? <p class="warn">This response is withdrawn.</p> : null}
      {props.event.staleness === "windows_changed" ? (
        <p class="warn">The offered times changed since you answered.</p>
      ) : null}
      {props.event.staleness === "reevaluation_required" ? (
        <p class="warn">The duration changed. Please re-confirm.</p>
      ) : null}
      <form method="post" action={`/r/${props.responseToken}`} class="card">
        <input type="hidden" name="responseVersion" value={String(props.event.responseVersion)} />
        <input type="hidden" name="eventVersion" value={String(props.event.eventVersion)} />
        {groups.map(([day, slots]) => (
          <section class="day">
            <h2>{day}</h2>
            <table>
              <tbody>
                {slots.map((slot) => {
                  const key = `${slot.start}|${slot.end}`;
                  const value = current.get(key) ?? "";
                  return (
                    <tr>
                      <td>{formatLocal(props.displayTimeZone, slot.start)}</td>
                      <td>
                        <select name={`slot:${key}`}>
                          <option value="" selected={value === ""}>
                            Unknown
                          </option>
                          <option value="available" selected={value === "available"}>
                            Available
                          </option>
                          <option value="tentative" selected={value === "tentative"}>
                            Tentative
                          </option>
                          <option value="unavailable" selected={value === "unavailable"}>
                            Unavailable
                          </option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
        <label>
          <input
            type="checkbox"
            name="remainderUnavailable"
            value="true"
            checked={
              props.event.coverageMode === "remainder_unavailable" && props.event.staleness === "current"
            }
          />{" "}
          Mark remaining as unavailable
        </label>
        <button type="submit">Update</button>
      </form>
      <form method="post" action={`/r/${props.responseToken}/withdraw`}>
        <input type="hidden" name="responseVersion" value={String(props.event.responseVersion)} />
        <button class="secondary" type="submit">
          Withdraw response
        </button>
      </form>
    </Layout>
  );
}

export function OrganizerPage(props: { event: OrganizerEvent; organizerToken: string; displayTimeZone: string }) {
  const top = props.event.tallies.slice(0, 40);
  const path = `/api/organizer/${props.organizerToken}`;
  return (
    <Layout
      title={`Organize · ${props.event.title}`}
      noReferrer
      script={webmcpScript([
        {
          name: "get_results",
          description: "Inspect response progress and workable full-duration options.",
          method: "GET",
          path,
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "finalize_poll",
          description: "Record a chosen interval against the current event and results versions.",
          method: "POST",
          path: `${path}/finalize`,
          inputSchema: {
            type: "object",
            properties: {
              start: { type: "string" },
              end: { type: "string" },
              eventVersion: { type: "integer" },
              resultsVersion: { type: "integer" },
              note: { type: "string" },
            },
            required: ["start", "end", "eventVersion", "resultsVersion"],
          },
        },
        {
          name: "update_event",
          description: "Edit poll metadata or replace the offered windows. Requires eventVersion.",
          method: "POST",
          path: `${path}/update`,
          inputSchema: {
            type: "object",
            properties: {
              eventVersion: { type: "integer" },
              title: { type: "string" },
              context: { type: ["string", "null"] },
              location: { type: ["string", "null"] },
              timezone: { type: "string" },
              durationMinutes: { type: "integer" },
              windows: { type: "array" },
              range: { type: "object" },
            },
            required: ["eventVersion"],
          },
        },
        {
          name: "close_poll",
          description: "Close collection without choosing a time.",
          method: "POST",
          path: `${path}/close`,
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "reopen_poll",
          description: "Reopen collection so participants can answer again.",
          method: "POST",
          path: `${path}/reopen`,
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "cancel_poll",
          description: "Cancel this poll.",
          method: "POST",
          path: `${path}/cancel`,
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "delete_poll",
          description: "Delete this poll.",
          method: "POST",
          path: `${path}/delete`,
          inputSchema: { type: "object", properties: {} },
        },
      ])}
    >
      <h1>{props.event.title}</h1>
      <div class="warn">
        This organizer URL is a private capability. It is not on the public page. Bookmark it.
      </div>
      <p>
        Status: {props.event.status}. Event v{props.event.eventVersion}, results v
        {props.event.resultsVersion}.
      </p>
      <p>
        <strong>Public invitation</strong>
        <br />
        <a class="secret" id="public-invitation" href={`/p/${props.event.publicId}`}>
          {`/p/${props.event.publicId}`}
        </a>
      </p>
      <p class="muted">{props.event.language}</p>
      {props.event.finalized ? (
        <div class="card">
          <p>
            Finalized: {formatLocal(props.displayTimeZone, props.event.finalized.start)} –{" "}
            {formatLocal(props.displayTimeZone, props.event.finalized.end)}
          </p>
          <p>
            <a href={`/o/${props.organizerToken}/event.ics`}>Download calendar file</a>
            <span class="muted"> — not a delivered invitation.</span>
          </p>
        </div>
      ) : null}
      <div class="card">
        <h2>Respondents</h2>
        {props.event.participants.length === 0 ? <p>None yet.</p> : null}
        <ul>
          {props.event.participants.map((person) => (
            <li>
              {person.displayName}
              {person.withdrawn ? " (withdrawn)" : ""}
              {person.staleness === "windows_changed" ? " · windows changed" : ""}
              {person.staleness === "reevaluation_required" ? " · reevaluation required" : ""}
              {" · updated "}
              {person.updatedAt}
            </li>
          ))}
        </ul>
      </div>
      <div class="card">
        <h2>Overlap</h2>
        <table>
          <thead>
            <tr>
              <th>Start</th>
              <th>Yes</th>
              <th>Tentative</th>
              <th>No</th>
              <th>Unknown</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {top.map((slot) => (
              <tr>
                <td>
                  {formatLocal(props.displayTimeZone, slot.start)}
                  {slot.fullSupport ? " · all respondents yes" : ""}
                </td>
                <td>{slot.available}</td>
                <td>{slot.tentative}</td>
                <td>{slot.unavailable}</td>
                <td>{slot.unknown}</td>
                <td>
                  {props.event.status === "open" || props.event.status === "closed" ? (
                    <form method="post" action={`/o/${props.organizerToken}/finalize`}>
                      <input type="hidden" name="start" value={slot.start} />
                      <input type="hidden" name="end" value={slot.end} />
                      <input type="hidden" name="eventVersion" value={String(props.event.eventVersion)} />
                      <input
                        type="hidden"
                        name="resultsVersion"
                        value={String(props.event.resultsVersion)}
                      />
                      <button type="submit" class="choose-slot">Choose</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.event.status === "open" || props.event.status === "closed" ? (
        <p>
          <a class="btn" href={`/o/${props.organizerToken}/edit`}>
            Edit poll
          </a>
        </p>
      ) : null}
      {props.event.status === "closed" || props.event.status === "cancelled" ? (
        <form method="post" action={`/o/${props.organizerToken}/reopen`}>
          <button type="submit">Reopen</button>
        </form>
      ) : null}
      {props.event.status === "open" ? (
        <form method="post" action={`/o/${props.organizerToken}/close`}>
          <button class="secondary" type="submit">
            Close without a decision
          </button>
        </form>
      ) : null}
      {props.event.status !== "finalized" ? (
        <form method="post" action={`/o/${props.organizerToken}/cancel`}>
          <button class="secondary" type="submit">
            Cancel poll
          </button>
        </form>
      ) : null}
      <form
        method="post"
        action={`/o/${props.organizerToken}/delete`}
        onsubmit="return confirm('Delete this poll and every response? This cannot be undone.')"
      >
        <button class="secondary" type="submit">
          Delete poll
        </button>
      </form>
    </Layout>
  );
}

export function EditPage(props: {
  event: OrganizerEvent;
  organizerToken: string;
  displayTimeZone: string;
}) {
  return (
    <Layout title={`Edit · ${props.event.title}`} noReferrer>
      <h1>Edit poll</h1>
      <p class="muted">
        Event v{props.event.eventVersion}. Changing windows or duration moves the event version.
        Title, context, location, and time zone do not.
      </p>
      <form method="get">
        <label>
          Display time zone <input name="tz" value={props.displayTimeZone} />
        </label>
        <button class="secondary" type="submit">
          Update display
        </button>
      </form>
      <form
        method="post"
        action={`/o/${props.organizerToken}/update`}
        class="card"
        onsubmit={`return this.durationMinutes.value === '${props.event.durationMinutes}' || confirm('Changing duration asks every respondent to re-confirm.')`}
      >
        <input type="hidden" name="eventVersion" value={String(props.event.eventVersion)} />
        <input type="hidden" name="displayTimeZone" value={props.displayTimeZone} />
        <label>
          Title
          <br />
          <input name="title" required maxlength={200} style="width:100%" value={props.event.title} />
        </label>
        <label>
          Context
          <br />
          <textarea name="context" rows={2} style="width:100%">{props.event.context ?? ""}</textarea>
        </label>
        <label>
          Location
          <br />
          <input name="location" maxlength={500} style="width:100%" value={props.event.location ?? ""} />
        </label>
        <label>
          Time zone
          <br />
          <input name="timezone" value={props.event.timezone} required />
        </label>
        <label>
          Duration (minutes)
          <br />
          <input
            name="durationMinutes"
            type="number"
            min={15}
            max={240}
            step={15}
            value={props.event.durationMinutes}
          />
        </label>
        <p class="muted">Changing duration asks every respondent to re-confirm.</p>
        <fieldset>
          <legend>Current windows</legend>
          <p class="muted">Uncheck a window to drop it. Times are absolute instants.</p>
          {props.event.windows.map((window) => (
            <label>
              <input type="checkbox" name={`window:${window.start}|${window.end}`} checked />{" "}
              {formatLocal(props.displayTimeZone, window.start)} –{" "}
              {formatLocal(props.displayTimeZone, window.end)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Add windows</legend>
          <p class="muted">Blank rows are ignored. Enter local times in {props.displayTimeZone}.</p>
          {Array.from({ length: 3 }, () => (
            <p>
              <input
                name="addStart[]"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                spellcheck={false}
                placeholder="YYYY-MM-DDTHH:mm"
                title="YYYY-MM-DDTHH:mm"
              />{" "}
              <input
                name="addEnd[]"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                spellcheck={false}
                placeholder="YYYY-MM-DDTHH:mm"
                title="YYYY-MM-DDTHH:mm"
              />
            </p>
          ))}
        </fieldset>
        <button type="submit">Save changes</button>
      </form>
      <p>
        <a href={`/o/${props.organizerToken}`}>Back to organizer</a>
      </p>
    </Layout>
  );
}

export function ErrorPage(props: { message: string; status: number }) {
  return (
    <Layout title="Error">
      <h1>Could not complete that</h1>
      <p>{props.message}</p>
      <p class="muted">HTTP {props.status}</p>
    </Layout>
  );
}

export function displayTimeZone(requested: string | undefined, authored: string): string {
  if (!requested) return authored;
  try {
    return assertTimeZone(requested);
  } catch {
    return authored;
  }
}

function groupCandidates(timeZone: string, candidates: Candidate[]): Array<[string, Candidate[]]> {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const day = instantToDate(timeZone, parseInstant(candidate.start));
    const list = groups.get(day) ?? [];
    list.push(candidate);
    groups.set(day, list);
  }
  return [...groups.entries()];
}

export function parseSlotFields(
  body: Record<string, string | File | (string | File)[]>,
): Array<{ start: string; end: string; state: "available" | "tentative" | "unavailable" }> {
  const intervals: Array<{ start: string; end: string; state: "available" | "tentative" | "unavailable" }> =
    [];
  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith("slot:") || typeof value !== "string" || value === "") continue;
    if (value !== "available" && value !== "tentative" && value !== "unavailable") {
      throw new DomainError("validation", "Invalid availability state.");
    }
    const packed = key.slice(5);
    const bar = packed.indexOf("|");
    intervals.push({ start: packed.slice(0, bar), end: packed.slice(bar + 1), state: value });
  }
  return intervals;
}

export function parseWindowFields(
  body: Record<string, string | File | (string | File)[]>,
  displayTimeZone: string,
): Interval[] {
  const offered: Interval[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith("window:") || !isChecked(value)) continue;
    const packed = key.slice("window:".length);
    const bar = packed.indexOf("|");
    offered.push({ start: packed.slice(0, bar), end: packed.slice(bar + 1) });
  }
  const starts = stringFields(body["addStart[]"] ?? body.addStart);
  const ends = stringFields(body["addEnd[]"] ?? body.addEnd);
  const count = Math.max(starts.length, ends.length);
  for (let index = 0; index < count; index += 1) {
    const startRaw = starts[index]?.trim() ?? "";
    const endRaw = ends[index]?.trim() ?? "";
    if (startRaw === "" && endRaw === "") continue;
    if (startRaw === "" || endRaw === "") {
      throw new DomainError("validation", "Added windows need both a start and an end.");
    }
    const startLocal = splitDateTimeLocal(startRaw);
    const endLocal = splitDateTimeLocal(endRaw);
    offered.push({
      start: iso(zonedLocal(displayTimeZone, startLocal.date, startLocal.time).toInstant()),
      end: iso(zonedLocal(displayTimeZone, endLocal.date, endLocal.time).toInstant()),
    });
  }
  return offered;
}

function isChecked(value: string | File | (string | File)[]): boolean {
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && item !== "");
  return typeof value === "string" && value !== "";
}

function stringFields(value: string | File | (string | File)[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : ""));
  return typeof value === "string" ? [value] : [];
}

function splitDateTimeLocal(value: string): { date: Temporal.PlainDate; time: Temporal.PlainTime } {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) {
    throw new DomainError("validation", "Added windows must use YYYY-MM-DDTHH:mm.");
  }
  try {
    return {
      date: Temporal.PlainDate.from(datePart),
      time: Temporal.PlainTime.from(timePart),
    };
  } catch {
    throw new DomainError("validation", "Added windows must use YYYY-MM-DDTHH:mm.");
  }
}
