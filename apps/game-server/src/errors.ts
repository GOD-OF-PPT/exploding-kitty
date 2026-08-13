import type { CommandProblem } from "./model.js";

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message = code,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function toProblem(error: unknown): CommandProblem {
  if (error instanceof ServiceError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof Error && error.name === "GameRuleError") {
    return { code: error.message, message: error.message, retryable: false };
  }
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const expected = new Set([
    "NOT_YOUR_TURN",
    "STALE_TURN",
    "STALE_WINDOW",
    "STALE_PROMPT",
    "CARD_NOT_OWNED",
    "WRONG_CARD_TYPE",
    "INVALID_TARGET",
    "INTERACTION_PENDING",
    "MATCH_FINISHED",
    "PLAYER_NOT_ACTIVE",
    "ALREADY_PASSED",
  ]);
  if (expected.has(code)) return { code, message: code, retryable: false };
  return { code: "INTERNAL_ERROR", message: "Internal server error", retryable: true };
}
