import { and, eq, inArray } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { DomainError } from "../domain/errors.ts";
import { newId } from "../domain/tokens.ts";
import { nowIso } from "../domain/time.ts";
import type {
  AvailabilityInterval,
  CoverageMode,
  Interval,
  PollStatus,
} from "../domain/types.ts";
import { idempotencyKeys, intervals, participants, polls, windows } from "./schema.ts";

export type Db = PgliteDatabase<typeof import("./schema.ts")>;

export type PollRecord = typeof polls.$inferSelect;
export type ParticipantRecord = typeof participants.$inferSelect;

export function createStore(db: Db) {
  return {
    async insertPoll(input: {
      id: string;
      publicId: string;
      organizerTokenHash: string;
      title: string;
      context: string | null;
      location: string | null;
      durationMinutes: number;
      timezone: string;
      windows: Interval[];
    }): Promise<PollRecord> {
      const now = nowIso();
      const [poll] = await db
        .insert(polls)
        .values({
          id: input.id,
          publicId: input.publicId,
          organizerTokenHash: input.organizerTokenHash,
          title: input.title,
          context: input.context,
          location: input.location,
          durationMinutes: input.durationMinutes,
          timezone: input.timezone,
          status: "open",
          eventVersion: 1,
          resultsVersion: 1,
          finalizedStart: null,
          finalizedEnd: null,
          finalizedNote: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!poll) throw new DomainError("conflict", "Could not create poll.");
      if (input.windows.length > 0) {
        await db.insert(windows).values(
          input.windows.map((window) => ({
            id: newId("win"),
            pollId: poll.id,
            startAt: window.start,
            endAt: window.end,
          })),
        );
      }
      return poll;
    },

    async getPollByPublicId(publicId: string): Promise<PollRecord | undefined> {
      const [poll] = await db.select().from(polls).where(eq(polls.publicId, publicId)).limit(1);
      return poll;
    },

    async getPollByOrganizerHash(hash: string): Promise<PollRecord | undefined> {
      const [poll] = await db.select().from(polls).where(eq(polls.organizerTokenHash, hash)).limit(1);
      return poll;
    },

    async getPollById(id: string): Promise<PollRecord | undefined> {
      const [poll] = await db.select().from(polls).where(eq(polls.id, id)).limit(1);
      return poll;
    },

    async listWindows(pollId: string): Promise<Interval[]> {
      const rows = await db.select().from(windows).where(eq(windows.pollId, pollId));
      return rows.map((row) => ({ start: row.startAt, end: row.endAt }));
    },

    async insertParticipant(input: {
      pollId: string;
      displayName: string;
      responseTokenHash: string;
      coverageMode: CoverageMode;
      intervals: AvailabilityInterval[];
    }): Promise<ParticipantRecord> {
      const now = nowIso();
      const [participant] = await db
        .insert(participants)
        .values({
          id: newId("rsp"),
          pollId: input.pollId,
          displayName: input.displayName,
          responseTokenHash: input.responseTokenHash,
          coverageMode: input.coverageMode,
          withdrawn: false,
          responseVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!participant) throw new DomainError("conflict", "Could not save response.");
      await replaceIntervals(db, participant.id, input.intervals);
      return participant;
    },

    async getParticipantByTokenHash(hash: string): Promise<ParticipantRecord | undefined> {
      const [row] = await db.select().from(participants).where(eq(participants.responseTokenHash, hash)).limit(1);
      return row;
    },

    async listParticipants(pollId: string): Promise<ParticipantRecord[]> {
      return db.select().from(participants).where(eq(participants.pollId, pollId));
    },

    async listIntervals(participantId: string): Promise<AvailabilityInterval[]> {
      const rows = await db.select().from(intervals).where(eq(intervals.participantId, participantId));
      return rows.map((row) => ({
        start: row.startAt,
        end: row.endAt,
        state: row.state as AvailabilityInterval["state"],
      }));
    },

    async updateParticipant(
      id: string,
      expectedVersion: number,
      patch: {
        coverageMode: CoverageMode;
        withdrawn: boolean;
        intervals: AvailabilityInterval[];
      },
    ): Promise<ParticipantRecord> {
      const now = nowIso();
      const updated = await db
        .update(participants)
        .set({
          coverageMode: patch.coverageMode,
          withdrawn: patch.withdrawn,
          responseVersion: expectedVersion + 1,
          updatedAt: now,
        })
        .where(and(eq(participants.id, id), eq(participants.responseVersion, expectedVersion)))
        .returning();
      const row = updated[0];
      if (!row) {
        throw new DomainError("stale_version", "This response changed. Reload and retry.");
      }
      await db.delete(intervals).where(eq(intervals.participantId, id));
      await replaceIntervals(db, id, patch.intervals);
      return row;
    },

    async bumpResultsVersion(pollId: string): Promise<number> {
      const poll = await this.getPollById(pollId);
      if (!poll) throw new DomainError("not_found", "Poll not found.");
      const [row] = await db
        .update(polls)
        .set({ resultsVersion: poll.resultsVersion + 1, updatedAt: nowIso() })
        .where(eq(polls.id, pollId))
        .returning();
      return row?.resultsVersion ?? poll.resultsVersion + 1;
    },

    async setStatus(
      pollId: string,
      status: PollStatus,
      extra: Partial<
        Pick<PollRecord, "finalizedStart" | "finalizedEnd" | "finalizedNote" | "eventVersion" | "resultsVersion">
      > = {},
    ): Promise<PollRecord> {
      const [row] = await db
        .update(polls)
        .set({ status, updatedAt: nowIso(), ...extra })
        .where(eq(polls.id, pollId))
        .returning();
      if (!row) throw new DomainError("not_found", "Poll not found.");
      return row;
    },

    async finalizeIfFresh(input: {
      pollId: string;
      eventVersion: number;
      resultsVersion: number;
      start: string;
      end: string;
      note: string | null;
    }): Promise<PollRecord> {
      const [row] = await db
        .update(polls)
        .set({
          status: "finalized",
          finalizedStart: input.start,
          finalizedEnd: input.end,
          finalizedNote: input.note,
          updatedAt: nowIso(),
        })
        .where(
          and(
            eq(polls.id, input.pollId),
            eq(polls.eventVersion, input.eventVersion),
            eq(polls.resultsVersion, input.resultsVersion),
            inArray(polls.status, ["open", "closed"]),
          ),
        )
        .returning();
      if (!row) {
        throw new DomainError(
          "stale_version",
          "The poll changed after you reviewed it. Reload results and select again.",
        );
      }
      return row;
    },

    async deletePoll(pollId: string): Promise<void> {
      await db.delete(polls).where(eq(polls.id, pollId));
    },

    async getIdempotency(key: string): Promise<string | undefined> {
      const [row] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);
      return row?.body;
    },

    async saveIdempotency(key: string, body: string): Promise<string> {
      await db.insert(idempotencyKeys).values({ key, body, createdAt: nowIso() }).onConflictDoNothing();
      const stored = await this.getIdempotency(key);
      if (!stored) {
        throw new DomainError("conflict", "Could not persist idempotency record.");
      }
      return stored;
    },
  };
}

async function replaceIntervals(db: Db, participantId: string, painted: AvailabilityInterval[]): Promise<void> {
  if (painted.length === 0) return;
  await db.insert(intervals).values(
    painted.map((interval) => ({
      id: newId("int"),
      participantId,
      startAt: interval.start,
      endAt: interval.end,
      state: interval.state,
    })),
  );
}

export type Store = ReturnType<typeof createStore>;
