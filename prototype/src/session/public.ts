/** A UI-level intention. Protocol metadata is added by a GameSession. */
export type PlayerIntent = Readonly<{
  type: string;
  [key: string]: unknown;
}>;

export type SessionLifecycle =
  | "opening"
  | "active"
  | "recovering"
  | "ended"
  | "failed";

export type SessionConnectivity =
  | "local"
  | "connecting"
  | "online"
  | "offline";

export type SessionProblem = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export type SessionSnapshot<TView = unknown> = Readonly<{
  lifecycle: SessionLifecycle;
  connectivity: SessionConnectivity;
  view: TView | null;
  pending: readonly string[];
  lastSequence: number;
  problem?: SessionProblem;
}>;

export type SendSuccess = Readonly<{
  ok: true;
  commandId: string;
  sequence: number;
}>;

export type SendFailure = Readonly<{
  ok: false;
  commandId: string;
  code: string;
  message: string;
  retryable: boolean;
}>;

export type SendResult = SendSuccess | SendFailure;

/**
 * The single seam consumed by React. getSnapshot is referentially stable
 * between subscribe notifications, send calls are processed in call order,
 * and expected operational failures are returned rather than thrown.
 */
export interface GameSession<TView = unknown> {
  readonly getSnapshot: () => SessionSnapshot<TView>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly send: (intent: PlayerIntent) => Promise<SendResult>;
  readonly dispose: () => void;
}

export type CommandEnvelope = Readonly<{
  type: "session.command";
  protocolVersion: 1;
  sessionId: string;
  commandId: string;
  sequence: number;
  sentAt: number;
  intent: PlayerIntent;
}>;

export type ResumeEnvelope = Readonly<{
  type: "session.resume";
  protocolVersion: 1;
  sessionId: string;
  lastSequence: number;
  resumeToken?: string;
}>;

export type ClientEnvelope = CommandEnvelope | ResumeEnvelope;

export type ServerViewEnvelope<TView = unknown> = Readonly<{
  type: "session.view";
  sessionId: string;
  sequence: number;
  view: TView;
  resumeToken?: string;
}>;

export type ServerSnapshotEnvelope<TView = unknown> = Readonly<{
  type: "session.snapshot";
  sessionId: string;
  sequence: number;
  view: TView;
  resumeToken?: string;
}>;

export type ServerCommandSuccessEnvelope<TView = unknown> = Readonly<{
  type: "session.command-result";
  sessionId: string;
  commandId: string;
  ok: true;
  sequence?: number;
  view?: TView;
  resumeToken?: string;
}>;

export type ServerCommandFailureEnvelope = Readonly<{
  type: "session.command-result";
  sessionId: string;
  commandId: string;
  ok: false;
  problem: SessionProblem;
}>;

export type ServerEnvelope<TView = unknown> =
  | ServerViewEnvelope<TView>
  | ServerSnapshotEnvelope<TView>
  | ServerCommandSuccessEnvelope<TView>
  | ServerCommandFailureEnvelope;
