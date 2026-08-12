import type {
  CommandEnvelope,
  PlayerIntent,
  SendFailure,
  SessionProblem,
} from "../public";

let fallbackId = 0;

export function defaultCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackId += 1;
  return `command-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

export function makeCommandEnvelope(input: {
  sessionId: string;
  commandId: string;
  sequence: number;
  sentAt: number;
  intent: PlayerIntent;
}): CommandEnvelope {
  return Object.freeze({
    type: "session.command",
    protocolVersion: 1,
    ...input,
  });
}

export function normalizeProblem(
  error: unknown,
  fallbackCode: string,
  retryable: boolean,
): SessionProblem {
  if (isProblem(error)) return Object.freeze({ ...error });
  return Object.freeze({
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error ?? fallbackCode),
    retryable,
  });
}

export function failure(commandId: string, problem: SessionProblem): SendFailure {
  return Object.freeze({ ok: false, commandId, ...problem });
}

function isProblem(value: unknown): value is SessionProblem {
  if (!value || typeof value !== "object") return false;
  const problem = value as Partial<SessionProblem>;
  return (
    typeof problem.code === "string" &&
    typeof problem.message === "string" &&
    typeof problem.retryable === "boolean"
  );
}
