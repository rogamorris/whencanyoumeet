import { MAX_PARTICIPANTS, MAX_TITLE, PUBLIC_BASE_URL, STEP_MINUTES } from "../config.ts";
import type { Store } from "../db/store.ts";
import { DomainError } from "./errors.ts";
import { resultsLanguage, sortTallies, tallyCandidates, validatePaintedIntervals } from "./overlap.ts";
import { hashToken, newId, publicId, randomToken } from "./tokens.ts";
import { assertTimeZone, parseInterval } from "./time.ts";
import type {
  CreatePollInput,
  CreatePollResult,
  FinalizeInput,
  OrganizerEvent,
  ParticipantView,
  PublicEvent,
  SubmitAvailabilityInput,
  SubmitAvailabilityResult,
  UpdateAvailabilityInput,
} from "./types.ts";
import { assertDuration, candidatesInWindows, expandRange } from "./windows.ts";

const DISCLOSURE =
  "Availability is information about a person. Unselected times stay unknown unless you explicitly mark remaining times as unavailable. This is not a calendar hold.";

export function createCommands(store: Store, publicBaseUrl = PUBLIC_BASE_URL) {
  function urls(publicPollId: string, organizerToken?: string, responseToken?: string) {
    return {
      publicUrl: `${publicBaseUrl}/p/${publicPollId}`,
      organizerUrl: organizerToken ? `${publicBaseUrl}/o/${organizerToken}` : undefined,
      responseUrl: responseToken ? `${publicBaseUrl}/r/${responseToken}` : undefined,
    };
  }

  async function loadWindowsAndCandidates(poll: { id: string; durationMinutes: number }) {
    const windowRows = await store.listWindows(poll.id);
    const candidates = candidatesInWindows(windowRows, poll.durationMinutes);
    return { windows: windowRows, candidates };
  }

  async function publicEvent(poll: NonNullable<Awaited<ReturnType<Store["getPollById"]>>>): Promise<PublicEvent> {
    const { windows, candidates } = await loadWindowsAndCandidates(poll);
    const people = await store.listParticipants(poll.id);
    const active = people.filter((person) => !person.withdrawn);
    return {
      publicId: poll.publicId,
      title: poll.title,
      context: poll.context,
      location: poll.location,
      durationMinutes: poll.durationMinutes,
      stepMinutes: STEP_MINUTES,
      timezone: poll.timezone,
      status: poll.status as PublicEvent["status"],
      eventVersion: poll.eventVersion,
      windows,
      candidates,
      respondentCount: active.length,
      finalized:
        poll.finalizedStart && poll.finalizedEnd
          ? { start: poll.finalizedStart, end: poll.finalizedEnd }
          : null,
      disclosure: DISCLOSURE,
    };
  }

  return {
    async createPoll(input: CreatePollInput): Promise<CreatePollResult> {
      const title = input.title.trim();
      if (!title || title.length > MAX_TITLE) {
        throw new DomainError("validation", `Title is required and must be at most ${MAX_TITLE} characters.`);
      }
      assertDuration(input.durationMinutes);
      const timezone = assertTimeZone(input.timezone);
      const windows = input.windows?.length
        ? input.windows
        : input.range
          ? expandRange(timezone, input.range)
          : [];
      candidatesInWindows(windows, input.durationMinutes);

      const organizerToken = randomToken();
      const pollPublicId = publicId();
      await store.insertPoll({
        id: newId("poll"),
        publicId: pollPublicId,
        organizerTokenHash: hashToken(organizerToken),
        title,
        context: input.context?.trim() || null,
        location: input.location?.trim() || null,
        durationMinutes: input.durationMinutes,
        timezone,
        windows,
      });
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
      const painted = await store.listIntervals(participant.id);
      return {
        ...event,
        responseId: participant.id,
        displayName: participant.displayName,
        coverageMode: participant.coverageMode as ParticipantView["coverageMode"],
        withdrawn: participant.withdrawn,
        responseVersion: participant.responseVersion,
        intervals: painted,
      };
    },

    async getOrganizerEvent(organizerToken: string): Promise<OrganizerEvent> {
      const poll = await store.getPollByOrganizerHash(hashToken(organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      const event = await publicEvent(poll);
      const people = await store.listParticipants(poll.id);
      const withIntervals = await Promise.all(
        people.map(async (person) => ({
          responseId: person.id,
          displayName: person.displayName,
          withdrawn: person.withdrawn,
          coverageMode: person.coverageMode as OrganizerEvent["participants"][number]["coverageMode"],
          updatedAt: person.updatedAt,
          intervals: await store.listIntervals(person.id),
        })),
      );
      const tallies = sortTallies(tallyCandidates(event.candidates, withIntervals));
      return {
        ...event,
        eventVersion: poll.eventVersion,
        resultsVersion: poll.resultsVersion,
        participants: withIntervals,
        tallies,
        language: resultsLanguage(event.respondentCount),
      };
    },

    async submitAvailability(input: SubmitAvailabilityInput): Promise<SubmitAvailabilityResult> {
      const poll = await store.getPollByPublicId(input.publicId);
      if (!poll) throw new DomainError("not_found", "Poll not found.");
      if (poll.status !== "open") {
        throw new DomainError("closed", "This poll is not accepting responses.");
      }
      const name = input.name.trim();
      if (!name) throw new DomainError("validation", "A display name is required.");
      const existing = await store.listParticipants(poll.id);
      if (existing.filter((row) => !row.withdrawn).length >= MAX_PARTICIPANTS) {
        throw new DomainError("limit", `This poll is limited to ${MAX_PARTICIPANTS} participants.`);
      }
      const windowRows = await store.listWindows(poll.id);
      const intervals = validatePaintedIntervals(input.intervals, windowRows);
      const responseToken = randomToken();
      await store.insertParticipant({
        pollId: poll.id,
        displayName: name,
        responseTokenHash: hashToken(responseToken),
        coverageMode: input.remainderUnavailable ? "remainder_unavailable" : "partial",
        intervals,
      });
      await store.bumpResultsVersion(poll.id);
      const { responseUrl } = urls(poll.publicId, undefined, responseToken);
      return {
        responseToken,
        responseUrl: responseUrl!,
        responseVersion: 1,
        receipt: "Saved availability. This did not reserve calendar time or send invitations.",
      };
    },

    async updateAvailability(input: UpdateAvailabilityInput): Promise<{ responseVersion: number; receipt: string }> {
      const participant = await store.getParticipantByTokenHash(hashToken(input.responseToken));
      if (!participant) throw new DomainError("not_found", "Response not found.");
      const poll = await store.getPollById(participant.pollId);
      if (!poll) throw new DomainError("not_found", "Poll not found.");
      if (poll.status !== "open") {
        throw new DomainError("closed", "This poll is not accepting response edits.");
      }
      const windowRows = await store.listWindows(poll.id);
      const painted = validatePaintedIntervals(input.intervals, windowRows);
      await store.updateParticipant(participant.id, input.responseVersion, {
        coverageMode: input.remainderUnavailable ? "remainder_unavailable" : "partial",
        withdrawn: false,
        intervals: painted,
      });
      await store.bumpResultsVersion(poll.id);
      return {
        responseVersion: input.responseVersion + 1,
        receipt: "Updated availability. This did not reserve calendar time.",
      };
    },

    async withdrawResponse(responseToken: string, responseVersion: number): Promise<{ receipt: string }> {
      const participant = await store.getParticipantByTokenHash(hashToken(responseToken));
      if (!participant) throw new DomainError("not_found", "Response not found.");
      const poll = await store.getPollById(participant.pollId);
      if (!poll) throw new DomainError("not_found", "Poll not found.");
      if (poll.status !== "open") {
        throw new DomainError("closed", "This poll is not accepting withdrawals.");
      }
      await store.updateParticipant(participant.id, responseVersion, {
        coverageMode: participant.coverageMode as "partial" | "remainder_unavailable",
        withdrawn: true,
        intervals: await store.listIntervals(participant.id),
      });
      await store.bumpResultsVersion(poll.id);
      return { receipt: "Response withdrawn." };
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
      const { candidates } = await loadWindowsAndCandidates(poll);
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
        receipt:
          "Recorded a decision. This page does not claim that a meeting invitation was sent.",
        icsUrl: `${publicBaseUrl}/o/${input.organizerToken}/event.ics`,
      };
    },

    async cancel(organizerToken: string): Promise<{ receipt: string }> {
      const poll = await store.getPollByOrganizerHash(hashToken(organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      if (poll.status === "finalized") {
        throw new DomainError("closed", "A finalized poll cannot be cancelled. Delete it instead.");
      }
      await store.setStatus(poll.id, "cancelled");
      return { receipt: "Poll cancelled." };
    },

    async close(organizerToken: string): Promise<{ receipt: string }> {
      const poll = await store.getPollByOrganizerHash(hashToken(organizerToken));
      if (!poll) throw new DomainError("not_found", "Organizer link not found.");
      if (poll.status !== "open") {
        throw new DomainError("closed", "Only an open poll can be closed without a decision.");
      }
      await store.setStatus(poll.id, "closed");
      return { receipt: "Collection closed without choosing a time." };
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
