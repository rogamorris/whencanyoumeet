import { createHash } from "node:crypto";
import { DomainError } from "./errors.ts";
import type {
  CreatePollInput,
  CreatePollResult,
  SubmitAvailabilityInput,
  SubmitAvailabilityResult,
  UpdateAvailabilityInput,
  UpdateAvailabilityResult,
  WithdrawResponseInput,
  WithdrawResponseResult,
} from "./types.ts";

export type WriteKind = "create" | "submit" | "update" | "withdraw";

export type IdempotencyResult = {
  create: CreatePollResult;
  submit: SubmitAvailabilityResult;
  update: UpdateAvailabilityResult;
  withdraw: WithdrawResponseResult;
};

export type IdempotencyRecord<K extends WriteKind = WriteKind> = {
  kind: K;
  requestHash: string;
  result: IdempotencyResult[K];
};

const ALREADY_USED = "Idempotency-Key already used with a different request.";

export function parseOptionalKey(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  return raw;
}

export function storageKey(kind: WriteKind, key: string, scope?: string): string {
  if (kind === "create") return `create:${key}`;
  if (kind === "submit" || kind === "update" || kind === "withdraw") {
    if (!scope) {
      throw new DomainError("conflict", "Could not persist idempotency record.");
    }
    return `${kind}:${scope}:${key}`;
  }
  const _exhaustive: never = kind;
  return _exhaustive;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function createFingerprint(input: CreatePollInput): unknown {
  const { idempotencyKey: _key, ...rest } = input;
  return rest;
}

export function submitFingerprint(input: SubmitAvailabilityInput): unknown {
  const { idempotencyKey: _key, ...rest } = input;
  return { ...rest, name: input.name.trim() };
}

export function updateFingerprint(input: UpdateAvailabilityInput): unknown {
  const { idempotencyKey: _key, responseToken: _token, ...rest } = input;
  return rest;
}

export function withdrawFingerprint(input: WithdrawResponseInput): unknown {
  return { responseVersion: input.responseVersion };
}

export function parseIdempotencyRecord<K extends WriteKind>(stored: string, kind: K): IdempotencyRecord<K> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new DomainError("conflict", ALREADY_USED);
  }
  if (!isRecord(parsed, kind)) {
    throw new DomainError("conflict", ALREADY_USED);
  }
  return parsed;
}

export function replayBound<K extends WriteKind>(stored: string, hash: string, kind: K): IdempotencyResult[K] {
  const record = parseIdempotencyRecord(stored, kind);
  if (record.requestHash !== hash) {
    throw new DomainError("conflict", ALREADY_USED);
  }
  return record.result;
}

export function serializeRecord<K extends WriteKind>(
  kind: K,
  hash: string,
  result: IdempotencyResult[K],
): string {
  return JSON.stringify({ kind, requestHash: hash, result });
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

function isRecord<K extends WriteKind>(value: unknown, kind: K): value is IdempotencyRecord<K> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.requestHash !== "string" || record.requestHash.length === 0) return false;
  if (!record.result || typeof record.result !== "object") return false;
  const storedKind = typeof record.kind === "string" ? record.kind : "create";
  if (storedKind !== kind) return false;
  const result = record.result as Record<string, unknown>;
  if (kind === "create") {
    return typeof result.organizerToken === "string" && typeof result.publicId === "string";
  }
  if (kind === "submit") {
    return typeof result.responseToken === "string" && typeof result.responseUrl === "string";
  }
  if (kind === "update") {
    return typeof result.responseVersion === "number" && typeof result.receipt === "string";
  }
  if (kind === "withdraw") {
    return typeof result.receipt === "string";
  }
  const _exhaustive: never = kind;
  return _exhaustive;
}
