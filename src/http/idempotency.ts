import { createHash } from "node:crypto";
import { DomainError } from "../domain/errors.ts";
import type { CreatePollResult } from "../domain/types.ts";

export type IdempotencyRecord = {
  requestHash: string;
  result: CreatePollResult;
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function parseIdempotencyRecord(stored: string): IdempotencyRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new DomainError("conflict", "Idempotency-Key already used with a different request.");
  }
  if (!isRecord(parsed)) {
    throw new DomainError("conflict", "Idempotency-Key already used with a different request.");
  }
  return parsed;
}

export function replayCreatePoll(stored: string, hash: string): CreatePollResult {
  const record = parseIdempotencyRecord(stored);
  if (record.requestHash !== hash) {
    throw new DomainError("conflict", "Idempotency-Key already used with a different request.");
  }
  return record.result;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is IdempotencyRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.requestHash !== "string" || record.requestHash.length === 0) return false;
  if (!record.result || typeof record.result !== "object") return false;
  const result = record.result as Record<string, unknown>;
  return typeof result.organizerToken === "string" && typeof result.publicId === "string";
}
