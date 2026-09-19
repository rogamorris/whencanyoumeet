import type { Context } from "hono";
import { DomainError, isDomainError } from "../domain/errors.ts";

const STATUS: Record<DomainError["code"], number> = {
  validation: 400,
  out_of_range: 400,
  not_found: 404,
  permission: 403,
  stale_version: 409,
  closed: 409,
  conflict: 409,
  limit: 429,
};

export function errorPayload(error: unknown): { status: number; body: { error: { code: string; message: string; details?: unknown } } } {
  if (isDomainError(error)) {
    return {
      status: STATUS[error.code],
      body: { error: { code: error.code, message: error.message, details: error.details } },
    };
  }
  console.error(error);
  return {
    status: 500,
    body: { error: { code: "internal", message: "Unexpected server error." } },
  };
}

export function jsonError(c: Context, error: unknown) {
  const { status, body } = errorPayload(error);
  return c.json(body, status as 400);
}

export function wantsJson(c: Context): boolean {
  const accept = c.req.header("accept") ?? "";
  const contentType = c.req.header("content-type") ?? "";
  return accept.includes("application/json") || contentType.includes("application/json");
}
