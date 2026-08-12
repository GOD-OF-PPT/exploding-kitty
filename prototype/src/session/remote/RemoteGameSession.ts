import type {
  SessionRepository,
  StoredSession,
} from "../../adapters/persistence/public";
import type {
  SessionTransport,
  TransportEvent,
} from "../../adapters/transport/public";
import { ExternalStore } from "../internal/ExternalStore";
import {
  defaultCommandId,
  failure,
  makeCommandEnvelope,
  normalizeProblem,
} from "../internal/commands";
import type {
  ClientEnvelope,
  GameSession,
  PlayerIntent,
  SendResult,
  ServerCommandSuccessEnvelope,
  ServerEnvelope,
  SessionProblem,
  SessionSnapshot,
} from "../public";

type RemotePayload<TView> = Readonly<{
  sequence: number;
  view: TView | null;
  resumeToken?: string;
}>;

export type RemoteGameSessionOptions<TView> = Readonly<{
  sessionId: string;
  transport: SessionTransport<ClientEnvelope, ServerEnvelope<TView>>;
  repository: SessionRepository;
  commandId?: () => string;
  now?: () => number;
  ackTimeoutMs?: number;
}>;

type AwaitingCommand<TView> = {
  commandId: string;
  resolve: (result: SendResult) => void;
  timer: ReturnType<typeof setTimeout>;
  success?: ServerCommandSuccessEnvelope<TView>;
};

export class RemoteGameSession<TView> implements GameSession<TView> {
  readonly getSnapshot;
  readonly subscribe;
  readonly #sessionId: string;
  readonly #transport: SessionTransport<ClientEnvelope, ServerEnvelope<TView>>;
  readonly #repository: SessionRepository;
  readonly #commandId: () => string;
  readonly #now: () => number;
  readonly #ackTimeoutMs: number;
  readonly #store: ExternalStore<SessionSnapshot<TView>>;
  readonly #unsubscribe: () => void;
  #sequence: number;
  #view: TView | null;
  #resumeToken?: string;
  #queue: Promise<void> = Promise.resolve();
  #awaiting: AwaitingCommand<TView> | null = null;
  #disposed = false;

  private constructor(
    options: RemoteGameSessionOptions<TView>,
    payload: RemotePayload<TView>,
  ) {
    this.#sessionId = options.sessionId;
    this.#transport = options.transport;
    this.#repository = options.repository;
    this.#commandId = options.commandId ?? defaultCommandId;
    this.#now = options.now ?? Date.now;
    this.#ackTimeoutMs = options.ackTimeoutMs ?? 10_000;
    this.#sequence = payload.sequence;
    this.#view = payload.view;
    this.#resumeToken = payload.resumeToken;
    this.#store = new ExternalStore({
      lifecycle: "recovering",
      connectivity: "connecting",
      view: this.#view,
      pending: [],
      lastSequence: this.#sequence,
    });
    this.getSnapshot = this.#store.getSnapshot;
    this.subscribe = this.#store.subscribe;
    this.#unsubscribe = this.#transport.subscribe((event) => this.#onTransport(event));
  }

  static async open<TView>(
    options: RemoteGameSessionOptions<TView>,
  ): Promise<RemoteGameSession<TView>> {
    let payload: RemotePayload<TView> = { sequence: 0, view: null };
    try {
      const value = await options.repository.load(options.sessionId);
      if (value?.mode === "remote") {
        payload = (value as StoredSession<RemotePayload<TView>>).payload;
      }
    } catch {
      // A remote session can recover from its server without cached storage.
    }
    return new RemoteGameSession(options, payload);
  }

  readonly send = (intent: PlayerIntent): Promise<SendResult> => {
    const commandId = this.#commandId();
    if (this.#disposed) return Promise.resolve(this.#disposedFailure(commandId));
    const task = this.#queue.then(() => this.#sendOne(intent, commandId));
    this.#queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  async #sendOne(intent: PlayerIntent, commandId: string): Promise<SendResult> {
    if (this.#disposed) return this.#disposedFailure(commandId);
    const snapshot = this.#store.getSnapshot();
    this.#publish({ pending: [...snapshot.pending, intent.type], problem: undefined });
    const command = makeCommandEnvelope({
      sessionId: this.#sessionId,
      commandId,
      sequence: this.#sequence,
      sentAt: this.#now(),
      intent,
    });
    try {
      await this.#transport.send(command);
    } catch (error) {
      const problem = normalizeProblem(error, "TRANSPORT_SEND_FAILED", true);
      this.#publish({ pending: [], problem });
      return failure(commandId, problem);
    }
    return new Promise<SendResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.#awaiting?.commandId !== commandId) return;
        this.#awaiting = null;
        const problem: SessionProblem = {
          code: "COMMAND_TIMEOUT",
          message: "The server did not acknowledge the command in time",
          retryable: true,
        };
        this.#publish({ pending: [], problem });
        resolve(failure(commandId, problem));
      }, this.#ackTimeoutMs);
      this.#awaiting = { commandId, resolve, timer };
    });
  }

  #onTransport(event: TransportEvent<ServerEnvelope<TView>>): void {
    if (this.#disposed) return;
    if (event.type === "open") {
      this.#publish({
        lifecycle: this.#view === null ? "opening" : "recovering",
        connectivity: "online",
        problem: undefined,
      });
      void this.#sendResume();
      return;
    }
    if (event.type === "closed") {
      this.#publish({
        lifecycle: "recovering",
        connectivity: event.retrying ? "connecting" : "offline",
        problem: {
          code: "TRANSPORT_CLOSED",
          message: event.reason ?? "Connection closed",
          retryable: event.retrying,
        },
      });
      return;
    }
    if (event.type === "fatal") {
      this.#publish({
        lifecycle: "failed",
        connectivity: "offline",
        problem: normalizeProblem(event.error, "TRANSPORT_FATAL", false),
      });
      this.#settleAwaiting(
        failure(
          this.#awaiting?.commandId ?? "transport",
          normalizeProblem(event.error, "TRANSPORT_FATAL", false),
        ),
      );
      return;
    }
    this.#onMessage(event.message);
  }

  #onMessage(message: ServerEnvelope<TView>): void {
    if (message.sessionId !== this.#sessionId) return;
    if (message.type === "session.command-result") {
      if (!this.#awaiting || message.commandId !== this.#awaiting.commandId) return;
      if (!message.ok) {
        this.#publish({ pending: [], problem: message.problem });
        this.#settleAwaiting(failure(message.commandId, message.problem));
        return;
      }
      this.#applyCommandSuccess(message);
      return;
    }
    if (message.type === "session.snapshot") {
      if (message.sequence < this.#sequence) return;
      this.#sequence = message.sequence;
      this.#view = message.view;
      this.#resumeToken = message.resumeToken ?? this.#resumeToken;
      this.#publish({ lifecycle: "active", connectivity: "online", problem: undefined });
      void this.#persist();
      return;
    }
    if (message.sequence <= this.#sequence) return;
    if (message.sequence !== this.#sequence + 1) {
      this.#publish({
        lifecycle: "recovering",
        problem: {
          code: "SEQUENCE_GAP",
          message: `Expected sequence ${this.#sequence + 1}, received ${message.sequence}`,
          retryable: true,
        },
      });
      void this.#sendResume();
      return;
    }
    this.#sequence = message.sequence;
    this.#view = message.view;
    this.#resumeToken = message.resumeToken ?? this.#resumeToken;
    this.#publish({ lifecycle: "active", connectivity: "online", problem: undefined });
    void this.#persist();
  }

  #applyCommandSuccess(message: ServerCommandSuccessEnvelope<TView>): void {
    if (message.sequence !== undefined) {
      if (message.sequence < this.#sequence) {
        // The acknowledgement may trail a pushed view; still settle the command.
      } else if (message.sequence > this.#sequence + 1 && message.view !== undefined) {
        const problem: SessionProblem = {
          code: "SEQUENCE_GAP",
          message: `Expected sequence ${this.#sequence + 1}, received ${message.sequence}`,
          retryable: true,
        };
        this.#publish({ lifecycle: "recovering", pending: [], problem });
        this.#settleAwaiting(failure(message.commandId, problem));
        void this.#sendResume();
        return;
      } else {
        this.#sequence = message.sequence;
      }
    }
    if (message.view !== undefined) this.#view = message.view;
    this.#resumeToken = message.resumeToken ?? this.#resumeToken;
    this.#publish({
      lifecycle: "active",
      connectivity: "online",
      pending: [],
      problem: undefined,
    });
    void this.#persist();
    this.#settleAwaiting({
      ok: true,
      commandId: message.commandId,
      sequence: this.#sequence,
    });
  }

  async #sendResume(): Promise<void> {
    try {
      await this.#transport.send({
        type: "session.resume",
        protocolVersion: 1,
        sessionId: this.#sessionId,
        lastSequence: this.#sequence,
        ...(this.#resumeToken ? { resumeToken: this.#resumeToken } : {}),
      });
    } catch (error) {
      this.#publish({
        lifecycle: "recovering",
        connectivity: "connecting",
        problem: normalizeProblem(error, "RESUME_FAILED", true),
      });
    }
  }

  async #persist(): Promise<void> {
    try {
      await this.#repository.save({
        schemaVersion: 1,
        mode: "remote",
        sessionId: this.#sessionId,
        updatedAt: this.#now(),
        payload: {
          sequence: this.#sequence,
          view: this.#view,
          ...(this.#resumeToken ? { resumeToken: this.#resumeToken } : {}),
        },
      });
    } catch (error) {
      this.#publish({ problem: normalizeProblem(error, "PERSISTENCE_FAILED", true) });
    }
  }

  #publish(
    change: Partial<
      Pick<
        SessionSnapshot<TView>,
        "lifecycle" | "connectivity" | "pending" | "problem"
      >
    >,
  ): void {
    const current = this.#store.getSnapshot();
    this.#store.set(
      Object.freeze({
        lifecycle: change.lifecycle ?? current.lifecycle,
        connectivity: change.connectivity ?? current.connectivity,
        view: this.#view,
        pending: Object.freeze([...(change.pending ?? current.pending)]),
        lastSequence: this.#sequence,
        ...(change.problem ? { problem: change.problem } : {}),
      }),
    );
  }

  #settleAwaiting(result: SendResult): void {
    const awaiting = this.#awaiting;
    if (!awaiting) return;
    this.#awaiting = null;
    clearTimeout(awaiting.timer);
    awaiting.resolve(result);
  }

  #disposedFailure(commandId: string) {
    return failure(commandId, {
      code: "SESSION_DISPOSED",
      message: "The game session has been disposed",
      retryable: false,
    });
  }

  readonly dispose = (): void => {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#awaiting) {
      this.#settleAwaiting(this.#disposedFailure(this.#awaiting.commandId));
    }
    this.#unsubscribe();
    this.#transport.dispose();
    this.#store.dispose();
  };
}
