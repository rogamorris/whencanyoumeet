import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { DomainError } from "../domain/errors.ts";
import { newId } from "../domain/tokens.ts";
import { nowIso } from "../domain/time.ts";
import type {
  Answer,
  AvailabilityInterval,
  AvailabilityState,
  CoverageMode,
  EventConstraints,
  Interval,
  Participant,
  PollMetadata,
  PollStatus,
  ValidConstraints,
} from "../domain/types.ts";
import { LIVE_STATUSES } from "../domain/types.ts";
import { idempotencyKeys, intervals, participants, polls, windows } from "./schema.ts";

export type Db = PgliteDatabase<typeof import("./schema.ts")>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type PollRecord = typeof polls.$inferSelect;
type ParticipantRow = typeof participants.$inferSelect;

export function parseEvaluated(json: string): EventConstraints {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new DomainError("conflict", "Stored answer constraints are unreadable.");
  }
  if (!isRecord(value)) {
    throw new DomainError("conflict", "Stored answer constraints are unreadable.");
  }
  if (
    typeof value.eventVersion !== "number" ||
    !Number.isInteger(value.eventVersion) ||
    value.eventVersion < 1 ||
    typeof value.durationMinutes !== "number" ||
    !Array.isArray(value.windows)
  ) {
    throw new DomainError("conflict", "Stored answer constraints are unreadable.");
  }
  const parsedWindows: Interval[] = [];
  for (const item of value.windows) {
    if (!isRecord(item) || typeof item.start !== "string" || typeof item.end !== "string") {
      throw new DomainError("conflict", "Stored answer constraints are unreadable.");
    }
    parsedWindows.push({ start: item.start, end: item.end });
  }
  return {
    eventVersion: value.eventVersion,
    durationMinutes: value.durationMinutes,
    windows: parsedWindows,
  };
}

export function createStore(db: Db) {
  return {
    async insertPoll(input: {
      id: string;
      publicId: string;
      organizerTokenHash: string;
      metadata: PollMetadata;
      constraints: ValidConstraints;
    }): Promise<PollRecord> {
      return db.transaction(async (tx) => {
        const now = nowIso();
        const [poll] = await tx
          .insert(polls)
          .values({
            id: input.id,
            publicId: input.publicId,
            organizerTokenHash: input.organizerTokenHash,
            title: input.metadata.title,
            context: input.metadata.context,
            location: input.metadata.location,
            durationMinutes: input.constraints.durationMinutes,
            timezone: input.metadata.timezone,
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
        await insertWindows(tx, poll.id, input.constraints.windows);
        return poll;
      });
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
      return rows
        .map((row) => ({ start: row.startAt, end: row.endAt }))
        .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    },

    async updatePollIfFresh(input: {
      pollId: string;
      expectedEventVersion: number;
      metadata: PollMetadata;
      constraints?: ValidConstraints;
    }): Promise<PollRecord> {
      return db.transaction(async (tx) => {
        const now = nowIso();
        const [row] = await tx
          .update(polls)
          .set({
            title: input.metadata.title,
            context: input.metadata.context,
            location: input.metadata.location,
            timezone: input.metadata.timezone,
            updatedAt: now,
            ...(input.constraints
              ? {
                  durationMinutes: input.constraints.durationMinutes,
                  eventVersion: input.expectedEventVersion + 1,
                }
              : {}),
          })
          .where(
            and(
              eq(polls.id, input.pollId),
              eq(polls.eventVersion, input.expectedEventVersion),
              inArray(polls.status, [...LIVE_STATUSES]),
            ),
          )
          .returning();
        if (!row) {
          throw new DomainError(
            "stale_version",
            "The poll changed after you reviewed it. Reload and retry.",
          );
        }
        if (input.constraints) {
          await tx.delete(windows).where(eq(windows.pollId, input.pollId));
          await insertWindows(tx, input.pollId, input.constraints.windows);
        }
        return row;
      });
    },

    async setStatusIf(
      pollId: string,
      from: readonly PollStatus[],
      to: PollStatus,
    ): Promise<PollRecord | undefined> {
      const [row] = await db
        .update(polls)
        .set({ status: to, updatedAt: nowIso() })
        .where(and(eq(polls.id, pollId), inArray(polls.status, [...from])))
        .returning();
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
            inArray(polls.status, [...LIVE_STATUSES]),
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

    async countActive(pollId: string): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(participants)
        .where(and(eq(participants.pollId, pollId), eq(participants.withdrawn, false)));
      return Number(row?.n ?? 0);
    },

    async listParticipants(pollId: string): Promise<Participant[]> {
      const rows = await db.select().from(participants).where(eq(participants.pollId, pollId));
      return hydrateParticipants(db, rows);
    },

    async getParticipantByTokenHash(hash: string): Promise<Participant | undefined> {
      const [row] = await db.select().from(participants).where(eq(participants.responseTokenHash, hash)).limit(1);
      if (!row) return undefined;
      const [participant] = await hydrateParticipants(db, [row]);
      return participant;
    },

    async insertParticipant(input: {
      pollId: string;
      displayName: string;
      responseTokenHash: string;
      answer: Answer;
    }): Promise<void> {
      await db.transaction(async (tx) => {
        await bumpResultsForAnswer(
          tx,
          input.pollId,
          input.answer.evaluated.eventVersion,
          "This poll is not accepting responses.",
        );
        const now = nowIso();
        const [participant] = await tx
          .insert(participants)
          .values({
            id: newId("rsp"),
            pollId: input.pollId,
            displayName: input.displayName,
            responseTokenHash: input.responseTokenHash,
            coverageMode: input.answer.coverageMode,
            evaluated: JSON.stringify(input.answer.evaluated),
            withdrawn: false,
            responseVersion: 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!participant) throw new DomainError("conflict", "Could not save response.");
        await replaceIntervals(tx, participant.id, input.answer.intervals);
      });
    },

    async updateParticipant(
      id: string,
      expectedVersion: number,
      patch: { withdrawn: boolean; answer?: Answer },
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(participants).where(eq(participants.id, id)).limit(1);
        if (!existing) throw new DomainError("not_found", "Response not found.");
        if (patch.answer) {
          await bumpResultsForAnswer(
            tx,
            existing.pollId,
            patch.answer.evaluated.eventVersion,
            "This poll is not accepting response edits.",
          );
        } else {
          await bumpResultsIfOpen(tx, existing.pollId, "This poll is not accepting withdrawals.");
        }
        const now = nowIso();
        const [row] = await tx
          .update(participants)
          .set({
            withdrawn: patch.withdrawn,
            responseVersion: expectedVersion + 1,
            updatedAt: now,
            ...(patch.answer
              ? {
                  coverageMode: patch.answer.coverageMode,
                  evaluated: JSON.stringify(patch.answer.evaluated),
                }
              : {}),
          })
          .where(and(eq(participants.id, id), eq(participants.responseVersion, expectedVersion)))
          .returning();
        if (!row) {
          throw new DomainError("stale_version", "This response changed. Reload and retry.");
        }
        if (patch.answer) {
          await tx.delete(intervals).where(eq(intervals.participantId, id));
          await replaceIntervals(tx, id, patch.answer.intervals);
        }
      });
    },

    async bumpResultsVersion(pollId: string): Promise<number> {
      const [row] = await db
        .update(polls)
        .set({ resultsVersion: sql`${polls.resultsVersion} + 1`, updatedAt: nowIso() })
        .where(eq(polls.id, pollId))
        .returning();
      if (!row) throw new DomainError("not_found", "Poll not found.");
      return row.resultsVersion;
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

    async replaceIdempotency(key: string, body: string): Promise<string> {
      await db
        .update(idempotencyKeys)
        .set({ body, createdAt: nowIso() })
        .where(eq(idempotencyKeys.key, key));
      const stored = await this.getIdempotency(key);
      if (!stored) {
        throw new DomainError("conflict", "Could not persist idempotency record.");
      }
      return stored;
    },
  };
}

export type Store = ReturnType<typeof createStore>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCoverageMode(value: string): CoverageMode {
  if (value === "partial" || value === "remainder_unavailable") return value;
  throw new DomainError("conflict", "Stored coverage mode is unreadable.");
}

function parseAvailabilityState(value: string): AvailabilityState {
  if (value === "available" || value === "tentative" || value === "unavailable") return value;
  throw new DomainError("conflict", "Stored availability state is unreadable.");
}

function toParticipant(row: ParticipantRow, painted: AvailabilityInterval[]): Participant {
  return {
    id: row.id,
    pollId: row.pollId,
    displayName: row.displayName,
    withdrawn: row.withdrawn,
    responseVersion: row.responseVersion,
    updatedAt: row.updatedAt,
    answer: {
      evaluated: parseEvaluated(row.evaluated),
      coverageMode: parseCoverageMode(row.coverageMode),
      intervals: painted,
    },
  };
}

async function hydrateParticipants(executor: Db | Tx, rows: ParticipantRow[]): Promise<Participant[]> {
  if (rows.length === 0) return [];
  const painted = await executor
    .select()
    .from(intervals)
    .where(
      inArray(
        intervals.participantId,
        rows.map((row) => row.id),
      ),
    );
  const byId = new Map<string, AvailabilityInterval[]>();
  for (const row of painted) {
    const list = byId.get(row.participantId) ?? [];
    list.push({
      start: row.startAt,
      end: row.endAt,
      state: parseAvailabilityState(row.state),
    });
    byId.set(row.participantId, list);
  }
  return rows.map((row) => toParticipant(row, byId.get(row.id) ?? []));
}

async function insertWindows(executor: Db | Tx, pollId: string, offered: Interval[]): Promise<void> {
  await executor.insert(windows).values(
    offered.map((window) => ({
      id: newId("win"),
      pollId,
      startAt: window.start,
      endAt: window.end,
    })),
  );
}

async function replaceIntervals(
  executor: Db | Tx,
  participantId: string,
  painted: AvailabilityInterval[],
): Promise<void> {
  if (painted.length === 0) return;
  await executor.insert(intervals).values(
    painted.map((interval) => ({
      id: newId("int"),
      participantId,
      startAt: interval.start,
      endAt: interval.end,
      state: interval.state,
    })),
  );
}

async function bumpResultsForAnswer(
  tx: Db | Tx,
  pollId: string,
  eventVersion: number,
  closedMessage: string,
): Promise<void> {
  const [row] = await tx
    .update(polls)
    .set({ resultsVersion: sql`${polls.resultsVersion} + 1`, updatedAt: nowIso() })
    .where(and(eq(polls.id, pollId), eq(polls.eventVersion, eventVersion), eq(polls.status, "open")))
    .returning();
  if (row) return;
  const [poll] = await tx.select().from(polls).where(eq(polls.id, pollId)).limit(1);
  if (!poll) throw new DomainError("not_found", "Poll not found.");
  if (poll.eventVersion !== eventVersion) {
    throw new DomainError(
      "stale_version",
      "The poll's offered times changed. Reload and answer the current version.",
    );
  }
  if (poll.status !== "open") {
    throw new DomainError("closed", closedMessage);
  }
  throw new DomainError("conflict", "The poll changed. Reload.");
}

async function bumpResultsIfOpen(tx: Db | Tx, pollId: string, closedMessage: string): Promise<void> {
  const [row] = await tx
    .update(polls)
    .set({ resultsVersion: sql`${polls.resultsVersion} + 1`, updatedAt: nowIso() })
    .where(and(eq(polls.id, pollId), eq(polls.status, "open")))
    .returning();
  if (row) return;
  const [poll] = await tx.select().from(polls).where(eq(polls.id, pollId)).limit(1);
  if (!poll) throw new DomainError("not_found", "Poll not found.");
  if (poll.status !== "open") {
    throw new DomainError("closed", closedMessage);
  }
  throw new DomainError("conflict", "The poll changed. Reload.");
}
