import { MAX_PARTICIPANTS, MAX_TITLE, PUBLIC_BASE_URL, STEP_MINUTES } from "../config.ts";
import type { PollRecord, Store, Tx } from "../db/store.ts";
import { DomainError } from "./errors.ts";
import {
  createFingerprint,
  parseOptionalKey,
  replayBound,
  requestHash,
  serializeRecord,
  storageKey,
  submitFingerprint,
  updateFingerprint,
  withdrawFingerprint,
  type IdempotencyResult,
  type WriteKind,
} from "./idempotency.ts";
import { resultsLanguage, sortTallies, staleness, tallyCandidates, validatePaintedIntervals } from "./overlap.ts";
import { hashToken, newId, publicId, randomToken } from "./tokens.ts";
import { assertTimeZone, parseInterval } from "./time.ts";
import type {
  CreatePollInput,
  CreatePollResult,
  FinalizeInput,
  OrganizerEvent,
  ParticipantView,
  PollMetadata,
  PollStatus,
  PublicEvent,
  SubmitAvailabilityInput,
  SubmitAvailabilityResult,
  UpdateAvailabilityInput,
  UpdateAvailabilityResult,
  UpdateEventInput,
  UpdateEventResult,
  WithdrawResponseInput,
  WithdrawResponseResult,
} from "./types.ts";
import { LIVE_STATUSES, REOPENABLE_STATUSES } from "./types.ts";
import { candidatesInWindows, constraintsEqual, parseConstraints } from "./windows.ts";

const DISCLOSURE =
  "Availability is information about a person. Unselected times stay unknown unless you explicitly mark remaining times as unavailable. This is not a calendar hold.";
const STALE_EVENT = "The poll's offered times changed. Reload and answer the current version.";
const REOPEN_RECEIPT = "Collection reopened. Participants can answer again.";
const CLOSE_RECEIPT = "Collection closed without choosing a time.";
const CONSTRAINTS_RECEIPT =
  "Updated the offered times. Participants who answered the previous version keep their answers where those times still exist.";
const METADATA_RECEIPT = "Updated the poll.";

export function parseTitle(raw: string): string {
  const title = raw.trim();
  if (!title || title.length > MAX_TITLE) {
    throw new DomainError("validation", `Title is required and must be at most ${MAX_TITLE} characters.`);
  }
  return title;
}

export function mergeMetadata(
  patch: Pick<UpdateEventInput, "title" | "context" | "location" | "timezone">,
  poll: PollRecord,
): PollMetadata {
  return {
    title: patch.title !== undefined ? parseTitle(patch.title) : poll.title,
    context: patch.context === undefined ? poll.context : optionalText(patch.context),
    location: patch.location === undefined ? poll.location : optionalText(patch.location),
    timezone: patch.timezone !== undefined ? assertTimeZone(patch.timezone) : poll.timezone,
  };
}

function optionalText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parsePollStatus(value: string): PollStatus {
  if (value === "open" || value === "closed" || value === "finalized" || value === "cancelled") {
    return value;
  }
  throw new DomainError("conflict", "Stored poll status is unreadable.");
}

export function createCommands(store: Store, publicBaseUrl = PUBLIC_BASE_URL) {
  function urls(publicPollId: string, organizerToken?: string, responseToken?: string) {
    return {
      publicUrl: `${publicBaseUrl}/p/${publicPollId}`,
      organizerUrl: organizerToken ? `${publicBaseUrl}/o/${organizerToken}` : undefined,
      responseUrl: responseToken ? `${publicBaseUrl}/r/${responseToken}` : undefined,
    };
  }

  async function currentConstraints(poll: PollRecord, tx?: Tx) {
    const windowRows = await store.listWindows(poll.id, tx);
    return {
      eventVersion: poll.eventVersion,
      durationMinutes: poll.durationMinutes,
      windows: windowRows,
    };
  }

  async function publicEvent(poll: PollRecord): Promise<PublicEvent> {
    const current = await currentConstraints(poll);
    const candidates = candidatesInWindows(current.windows, current.durationMinutes);
    const respondentCount = await store.countActive(poll.id);
    return {
      publicId: poll.publicId,
      title: poll.title,
      context: poll.context,
      location: poll.location,
      durationMinutes: poll.durationMinutes,
      stepMinutes: STEP_MINUTES,
      timezone: poll.timezone,
      status: parsePollStatus(poll.status),
      eventVersion: poll.eventVersion,
      windows: current.windows,
      candidates,
      respondentCount,
      finalized:
        poll.finalizedStart && poll.finalizedEnd
          ? { start: poll.finalizedStart, end: poll.finalizedEnd }
          : null,
      disclosure: DISCLOSURE,
    };
  }

  async function bindWrite<K extends WriteKind>(opts: {
    kind: K;
    rawKey: string | undefined;
    scope?: string;
    fingerprint: unknown;
    live: (result: IdempotencyResult[K]) => Promise<boolean>;
    onDead: "replace" | "gone";
    write: (tx?: Tx) => Promise<IdempotencyResult[K]>;
  }): Promise<IdempotencyResult[K]> {
    const key = parseOptionalKey(opts.rawKey);
    if (!key) return opts.write();
    const storedKey = storageKey(opts.kind, key, opts.scope);
    const hash = requestHash(opts.fingerprint);
    const stored = await store.getIdempotency(storedKey);
    if (stored) {
      const result = replayBound(stored, hash, opts.kind);
      if (await opts.live(result)) return result;
      if (opts.onDead === "gone") {
        throw new DomainError(
          "not_found",
          opts.kind === "create" ? "Organizer link not found." : "Response not found.",
        );
      }
      return replayBound(
        await store.replaceBoundWrite(storedKey, async (tx) =>
          serializeRecord(opts.kind, hash, await opts.write(tx)),
        ),
        hash,
        opts.kind,
      );
    }
    return replayBound(
      await store.commitBoundWrite(storedKey, async (tx) =>
        serializeRecord(opts.kind, hash, await opts.write(tx)),
      ),
      hash,
      opts.kind,
    );
  }

  return {
    async createPoll(input: CreatePollInput): Promise<CreatePollResult> {
      const title = parseTitle(input.title);
      const timezone = assertTimeZone(input.timezone);
      const constraints = parseConstraints({
        durationMinutes: input.durationMinutes,
        timezone,
        windows: input.windows,
        range: input.range,
      });
      return bindWrite({
        kind: "create",
        rawKey: input.idempotencyKey,
        fingerprint: createFingerprint(input),
        live: async (result) => Boolean(await store.getPollByOrganizerHash(hashToken(result.organizerToken))),
        onDead: "replace",
        write: async (tx) => {
          const organizerToken = randomToken();
          const pollPublicId = publicId();
          await store.insertPoll(
            {
              id: newId("poll"),
              publicId: pollPublicId,
              organizerTokenHash: hashToken(organizerToken),
              metadata: {
                title,
                context: input.context?.trim() ? input.context.trim() : null,
                location: input.location?.trim() ? input.location.trim() : null,
                timezone,
              },
              constraints,
            },
            tx,
          );
          const { publicUrl, organizerUrl } = urls(pollPublicId, organizerToken);
          return {
            publicId: pollPublicId,
            publicUrl,
            organizerToken,
            organizerUrl: organizerUrl!,
            eventVersion: 1,
            resultsVersion: 1,
          };
        },
      });
    },

    async getPublicEvent(pollPublicId: string): Promise<PublicEvent> {
      const poll = await store.getPollByPublicId(pollPublicId);
      if (!poll) throw new DomainError("not_found", "Poll not found.");
      return publicEvent(poll);
    },

    async getParticipantEvent(responseToken: string): Promise<ParticipantView> {
      const participant = await store.getParticipantByTokenHash(hashToken(responseToken));
      if (!participant) throw new DomainError("not_found", "Response not found.");
      const poll = await store.getPollById(participant.pollId);
      if (!poll) throw new DomainError("not_found", "Poll not found.");
      const event = await publicEvent(poll);
      const current = await currentConstraints(poll);
      return {
        ...event,
        responseId: participant.id,
        displayName: participant.displayName,
        coverageMode: participant.answer.coverageMode,
        withdrawn: participant.withdrawn,
        responseVersion: participant.responseVersion,
        intervals: participant.answer.intervals,
        evaluated: participant.answer.evaluated,
        staleness: staleness(participant.answer, current),
      };
    },

    async getOrganizerEvent(organizerToken: string): Promise<OrganizerEvent> {
      const poll = await store.getPollByOrganizerHash(hashToken(organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      const event = await publicEvent(poll);
      const current = await currentConstraints(poll);
      const people = await store.listParticipants(poll.id);
      const listed = people.map((person) => ({
        responseId: person.id,
        displayName: person.displayName,
        withdrawn: person.withdrawn,
        coverageMode: person.answer.coverageMode,
        updatedAt: person.updatedAt,
        intervals: person.answer.intervals,
        evaluatedEventVersion: person.answer.evaluated.eventVersion,
        staleness: staleness(person.answer, current),
      }));
      const tallies = sortTallies(tallyCandidates(event.candidates, people, current));
      const active = people.filter((person) => !person.withdrawn);
      const reevaluationRequired = active.filter(
        (person) => staleness(person.answer, current) === "reevaluation_required",
      ).length;
      return {
        ...event,
        eventVersion: poll.eventVersion,
        resultsVersion: poll.resultsVersion,
        participants: listed,
        tallies,
        language: resultsLanguage(active.length, reevaluationRequired),
      };
    },

    async submitAvailability(input: SubmitAvailabilityInput): Promise<SubmitAvailabilityResult> {
      return bindWrite({
        kind: "submit",
        rawKey: input.idempotencyKey,
        scope: input.publicId,
        fingerprint: submitFingerprint(input),
        live: async (result) => Boolean(await store.getParticipantByTokenHash(hashToken(result.responseToken))),
        onDead: "gone",
        write: async (tx) => {
          const name = input.name.trim();
          if (!name) throw new DomainError("validation", "A display name is required.");
          const poll = await store.getPollByPublicId(input.publicId, tx);
          if (!poll) throw new DomainError("not_found", "Poll not found.");
          if (poll.status !== "open") {
            throw new DomainError("closed", "This poll is not accepting responses.");
          }
          if ((await store.countActive(poll.id, tx)) >= MAX_PARTICIPANTS) {
            throw new DomainError("limit", `This poll is limited to ${MAX_PARTICIPANTS} participants.`);
          }
          if (input.eventVersion !== poll.eventVersion) {
            throw new DomainError("stale_version", STALE_EVENT);
          }
          const current = await currentConstraints(poll, tx);
          const intervals = validatePaintedIntervals(input.intervals, current.windows);
          const responseToken = randomToken();
          await store.insertParticipant(
            {
              pollId: poll.id,
              displayName: name,
              responseTokenHash: hashToken(responseToken),
              answer: {
                evaluated: current,
                coverageMode: input.remainderUnavailable ? "remainder_unavailable" : "partial",
                intervals,
              },
            },
            tx,
          );
          const { responseUrl } = urls(poll.publicId, undefined, responseToken);
          return {
            responseToken,
            responseUrl: responseUrl!,
            responseVersion: 1,
            receipt: "Saved availability. This did not reserve calendar time or send invitations.",
          };
        },
      });
    },

    async updateAvailability(input: UpdateAvailabilityInput): Promise<UpdateAvailabilityResult> {
      return bindWrite({
        kind: "update",
        rawKey: input.idempotencyKey,
        scope: hashToken(input.responseToken),
        fingerprint: updateFingerprint(input),
        live: async () => Boolean(await store.getParticipantByTokenHash(hashToken(input.responseToken))),
        onDead: "gone",
        write: async (tx) => {
          const participant = await store.getParticipantByTokenHash(hashToken(input.responseToken), tx);
          if (!participant) throw new DomainError("not_found", "Response not found.");
          const poll = await store.getPollById(participant.pollId, tx);
          if (!poll) throw new DomainError("not_found", "Poll not found.");
          if (poll.status !== "open") {
            throw new DomainError("closed", "This poll is not accepting response edits.");
          }
          if (input.eventVersion !== poll.eventVersion) {
            throw new DomainError("stale_version", STALE_EVENT);
          }
          const current = await currentConstraints(poll, tx);
          const painted = validatePaintedIntervals(input.intervals, current.windows);
          await store.updateParticipant(
            participant.id,
            input.responseVersion,
            {
              withdrawn: false,
              answer: {
                evaluated: current,
                coverageMode: input.remainderUnavailable ? "remainder_unavailable" : "partial",
                intervals: painted,
              },
            },
            tx,
          );
          return {
            responseVersion: input.responseVersion + 1,
            receipt: "Updated availability. This did not reserve calendar time.",
          };
        },
      });
    },

    async withdrawResponse(input: WithdrawResponseInput): Promise<WithdrawResponseResult> {
      return bindWrite({
        kind: "withdraw",
        rawKey: input.idempotencyKey,
        scope: hashToken(input.responseToken),
        fingerprint: withdrawFingerprint(input),
        live: async () => Boolean(await store.getParticipantByTokenHash(hashToken(input.responseToken))),
        onDead: "gone",
        write: async (tx) => {
          const participant = await store.getParticipantByTokenHash(hashToken(input.responseToken), tx);
          if (!participant) throw new DomainError("not_found", "Response not found.");
          const poll = await store.getPollById(participant.pollId, tx);
          if (!poll) throw new DomainError("not_found", "Poll not found.");
          if (poll.status !== "open") {
            throw new DomainError("closed", "This poll is not accepting withdrawals.");
          }
          await store.updateParticipant(participant.id, input.responseVersion, { withdrawn: true }, tx);
          return { receipt: "Response withdrawn." };
        },
      });
    },

    async finalize(input: FinalizeInput): Promise<{ receipt: string; icsUrl: string }> {
      const poll = await store.getPollByOrganizerHash(hashToken(input.organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      if (poll.status === "finalized") {
        throw new DomainError("conflict", "This poll is already finalized.");
      }
      if (poll.status === "cancelled") {
        throw new DomainError("closed", "A cancelled poll cannot be finalized.");
      }
      const { start, end } = parseInterval({ start: input.start, end: input.end });
      const current = await currentConstraints(poll);
      const candidates = candidatesInWindows(current.windows, current.durationMinutes);
      const match = candidates.some(
        (candidate) => candidate.start === input.start && candidate.end === input.end,
      );
      if (!match) {
        throw new DomainError("out_of_range", "Final time must be one of the poll's full-duration candidates.");
      }
      void start;
      void end;
      await store.finalizeIfFresh({
        pollId: poll.id,
        eventVersion: input.eventVersion,
        resultsVersion: input.resultsVersion,
        start: input.start,
        end: input.end,
        note: input.note?.trim() || null,
      });
      return {
        receipt: "Recorded a decision. This page does not claim that a meeting invitation was sent.",
        icsUrl: `${publicBaseUrl}/o/${input.organizerToken}/event.ics`,
      };
    },

    async updateEvent(input: UpdateEventInput): Promise<UpdateEventResult> {
      const poll = await store.getPollByOrganizerHash(hashToken(input.organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      const status = parsePollStatus(poll.status);
      if (status !== "open" && status !== "closed") {
        throw new DomainError(
          "closed",
          status === "finalized" ? "A finalized poll cannot be edited." : "Reopen the poll before editing it.",
        );
      }
      const metadata = mergeMetadata(input, poll);
      const currentWindows = await store.listWindows(poll.id);
      const merged = parseConstraints({
        durationMinutes: input.durationMinutes ?? poll.durationMinutes,
        timezone: metadata.timezone,
        windows: input.windows ?? (input.range ? undefined : currentWindows),
        range: input.range,
      });
      const stored = parseConstraints({
        durationMinutes: poll.durationMinutes,
        timezone: poll.timezone,
        windows: currentWindows,
      });
      const changed = !constraintsEqual(merged, stored);
      const row = await store.updatePollIfFresh({
        pollId: poll.id,
        expectedEventVersion: input.eventVersion,
        metadata,
        constraints: changed ? merged : undefined,
      });
      return {
        eventVersion: row.eventVersion,
        constraintsChanged: changed,
        receipt: changed ? CONSTRAINTS_RECEIPT : METADATA_RECEIPT,
      };
    },

    async reopen(organizerToken: string): Promise<{ receipt: string }> {
      const poll = await store.getPollByOrganizerHash(hashToken(organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      const status = parsePollStatus(poll.status);
      if (status === "open") return { receipt: REOPEN_RECEIPT };
      if (status === "finalized") {
        throw new DomainError(
          "closed",
          "A finalized poll cannot be reopened. Delete it and create a new poll.",
        );
      }
      const row = await store.setStatusIf(poll.id, REOPENABLE_STATUSES, "open");
      if (!row) {
        throw new DomainError("conflict", "The poll changed while reopening. Reload.");
      }
      return { receipt: REOPEN_RECEIPT };
    },

    async cancel(organizerToken: string): Promise<{ receipt: string }> {
      const poll = await store.getPollByOrganizerHash(hashToken(organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      const status = parsePollStatus(poll.status);
      if (status === "finalized") {
        throw new DomainError("closed", "A finalized poll cannot be cancelled. Delete it instead.");
      }
      if (status === "cancelled") {
        return { receipt: "Poll cancelled." };
      }
      const row = await store.setStatusIf(poll.id, LIVE_STATUSES, "cancelled");
      if (!row) {
        const latest = await store.getPollById(poll.id);
        if (latest && parsePollStatus(latest.status) === "cancelled") {
          return { receipt: "Poll cancelled." };
        }
        if (latest && parsePollStatus(latest.status) === "finalized") {
          throw new DomainError("closed", "A finalized poll cannot be cancelled. Delete it instead.");
        }
        throw new DomainError("conflict", "The poll changed while cancelling. Reload.");
      }
      return { receipt: "Poll cancelled." };
    },

    async close(organizerToken: string): Promise<{ receipt: string }> {
      const poll = await store.getPollByOrganizerHash(hashToken(organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      const status = parsePollStatus(poll.status);
      if (status === "closed") {
        return { receipt: CLOSE_RECEIPT };
      }
      if (status !== "open") {
        throw new DomainError("closed", "Only an open poll can be closed without a decision.");
      }
      const row = await store.setStatusIf(poll.id, ["open"], "closed");
      if (!row) {
        const latest = await store.getPollById(poll.id);
        if (latest && parsePollStatus(latest.status) === "closed") {
          return { receipt: CLOSE_RECEIPT };
        }
        throw new DomainError("closed", "Only an open poll can be closed without a decision.");
      }
      return { receipt: CLOSE_RECEIPT };
    },

    async deletePoll(organizerToken: string): Promise<{ receipt: string }> {
      const poll = await store.getPollByOrganizerHash(hashToken(organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      await store.deletePoll(poll.id);
      return { receipt: "Poll deleted." };
    },
  };
}

export type Commands = ReturnType<typeof createCommands>;
