import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

export const polls = pgTable("polls", {
  id: text("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),
  organizerTokenHash: text("organizer_token_hash").notNull().unique(),
  title: text("title").notNull(),
  context: text("context"),
  location: text("location"),
  durationMinutes: integer("duration_minutes").notNull(),
  timezone: text("timezone").notNull(),
  status: text("status").notNull(),
  eventVersion: integer("event_version").notNull(),
  resultsVersion: integer("results_version").notNull(),
  finalizedStart: text("finalized_start"),
  finalizedEnd: text("finalized_end"),
  finalizedNote: text("finalized_note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const windows = pgTable("windows", {
  id: text("id").primaryKey(),
  pollId: text("poll_id").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
});

export const participants = pgTable("participants", {
  id: text("id").primaryKey(),
  pollId: text("poll_id").notNull(),
  displayName: text("display_name").notNull(),
  responseTokenHash: text("response_token_hash").notNull().unique(),
  coverageMode: text("coverage_mode").notNull(),
  evaluated: text("evaluated").notNull(),
  withdrawn: boolean("withdrawn").notNull(),
  responseVersion: integer("response_version").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const intervals = pgTable("intervals", {
  id: text("id").primaryKey(),
  participantId: text("participant_id").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  state: text("state").notNull(),
});

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
});
