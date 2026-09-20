import type { PGlite } from "@electric-sql/pglite";

export async function migrate(client: PGlite): Promise<void> {
  await client.waitReady;
  await client.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      organizer_token_hash TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      context TEXT,
      location TEXT,
      duration_minutes INTEGER NOT NULL,
      timezone TEXT NOT NULL,
      status TEXT NOT NULL,
      event_version INTEGER NOT NULL,
      results_version INTEGER NOT NULL,
      finalized_start TEXT,
      finalized_end TEXT,
      finalized_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS windows (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      response_token_hash TEXT NOT NULL UNIQUE,
      coverage_mode TEXT NOT NULL,
      withdrawn BOOLEAN NOT NULL,
      response_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intervals (
      id TEXT PRIMARY KEY,
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      state TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS windows_poll_id_idx ON windows(poll_id);
    CREATE INDEX IF NOT EXISTS participants_poll_id_idx ON participants(poll_id);
    CREATE INDEX IF NOT EXISTS intervals_participant_id_idx ON intervals(participant_id);

    ALTER TABLE participants ADD COLUMN IF NOT EXISTS evaluated TEXT;
    UPDATE participants p SET evaluated = (
      SELECT json_build_object(
        'eventVersion', polls.event_version,
        'durationMinutes', polls.duration_minutes,
        'windows', COALESCE((SELECT json_agg(json_build_object('start', w.start_at, 'end', w.end_at) ORDER BY w.start_at)
                             FROM windows w WHERE w.poll_id = polls.id), '[]'::json))
      FROM polls WHERE polls.id = p.poll_id)
    WHERE p.evaluated IS NULL;
    ALTER TABLE participants ALTER COLUMN evaluated SET NOT NULL;
  `);
}
