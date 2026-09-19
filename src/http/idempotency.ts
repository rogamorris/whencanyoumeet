import { createHash } from "node:crypto";

export type IdempotencyRecord<T> = {
  requestHash: string;
  result: T;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function parseIdempotencyRecord<T>(stored: string): IdempotencyRecord<T> | undefined {
  const parsed = JSON.parse(stored) as { requestHash?: unknown; result?: unknown };
  if (typeof parsed.requestHash === "string" && "result" in parsed) {
    return { requestHash: parsed.requestHash, result: parsed.result as T };
  }
  return undefined;
}
