export type ErrorCode =
  | "validation"
  | "not_found"
  | "permission"
  | "stale_version"
  | "closed"
  | "out_of_range"
  | "conflict"
  | "limit";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
