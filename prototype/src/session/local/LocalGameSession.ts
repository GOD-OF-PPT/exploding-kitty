import type {
  SessionRepository,
  StoredSession,
} from "../../adapters/persistence/public";
import { ExternalStore } from "../internal/ExternalStore";
import {
  defaultCommandId,
  failure,
  makeCommandEnvelope,
  normalizeProblem,
} from "../internal/commands";
import type {
  CommandEnvelope,
  GameSession,
  PlayerIntent,
  SendResult,
  SessionProblem,
  SessionSnapshot,
} from "../public";

export type LocalKernelResult<TState> =
  | Readonly<{ ok: true; state: TState }>
  | Readonly<{ ok: false; state: TState; problem: SessionProblem }>;

/**
 * Adapter required by LocalGameSession. It owns rule semantics while the
 * session owns command ordering, envelopes, player projection and recovery.
 */
export interface LocalKernelAdapter<TState, TView> {
  create(): TState | Promise<TState>;
  restore(payload: unknown): TState | Promise<TState>;
  execute(
    state: TState,
    command: CommandEnvelope,
  ): LocalKernelResult<TState> | Promise<LocalKernelResult<TState>>;
  project(state: TState): TView;
  serialize(state: TState): unknown;
  dispose?(): void;
}

type LocalPayload = Readonly<{ kernel: unknown; sequence: number }>;

export type LocalGameSessionOptions<TState, TView> = Readonly<{
  sessionId: string;
  kernel: LocalKernelAdapter<TState, TView>;
  repository: SessionRepository;
  commandId?: () => string;
  now?: () => number;
}>;

export class LocalGameSession<TState, TView> implements GameSession<TView> {
  readonly getSnapshot;
  readonly subscribe;
  readonly #sessionId: string;
  readonly #kernel: LocalKernelAdapter<TState, TView>;
  readonly #repository: SessionRepository;
  readonly #commandId: () => string;
  readonly #now: () => number;
  readonly #store: ExternalStore<SessionSnapshot<TView>>;
  #state: TState;
  #sequence: number;
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;

  private constructor(
    options: LocalGameSessionOptions<TState, TView>,
    state: TState,
    sequence: number,
  ) {
    this.#sessionId = options.sessionId;
    this.#kernel = options.kernel;
    this.#repository = options.repository;
    this.#commandId = options.commandId ?? defaultCommandId;
    this.#now = options.now ?? Date.now;
    this.#state = state;
    this.#sequence = sequence;
    this.#store = new ExternalStore({
      lifecycle: "active",
      connectivity: "local",
      view: this.#kernel.project(state),
      pending: [],
      lastSequence: sequence,
    });
    this.getSnapshot = this.#store.getSnapshot;
    this.subscribe = this.#store.subscribe;
  }

  static async open<TState, TView>(
    options: LocalGameSessionOptions<TState, TView>,
  ): Promise<LocalGameSession<TState, TView>> {
    let restored: StoredSession<LocalPayload> | null = null;
    try {
      const value = await options.repository.load(options.sessionId);
      if (value?.mode === "local") restored = value as StoredSession<LocalPayload>;
    } catch {
      // Storage is a recovery aid; a new local session remains playable.
    }
    const payload = restored?.payload;
    const state = payload
      ? await options.kernel.restore(payload.kernel)
      : await options.kernel.create();
    return new LocalGameSession(options, state, payload?.sequence ?? 0);
  }

  readonly send = (intent: PlayerIntent): Promise<SendResult> => {
    const commandId = this.#commandId();
    if (this.#disposed) {
      return Promise.resolve(
        failure(commandId, {
          code: "SESSION_DISPOSED",
          message: "The game session has been disposed",
          retryable: false,
        }),
      );
    }
    const task = this.#queue.then(() => this.#execute(intent, commandId));
    this.#queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  async #execute(intent: PlayerIntent, commandId: string): Promise<SendResult> {
    if (this.#disposed) {
      return failure(commandId, {
        code: "SESSION_DISPOSED",
        message: "The game session has been disposed",
        retryable: false,
      });
    }
    const pending = [...this.#store.getSnapshot().pending, intent.type];
    this.#setSnapshot({ pending, problem: undefined });
    const command = makeCommandEnvelope({
      sessionId: this.#sessionId,
      commandId,
      sequence: this.#sequence,
      sentAt: this.#now(),
      intent,
    });
    try {
      const result = await this.#kernel.execute(this.#state, command);
      if (!result.ok) {
        this.#state = result.state;
        this.#setSnapshot({ pending: [], problem: result.problem });
        return failure(commandId, result.problem);
      }
      this.#state = result.state;
      this.#sequence += 1;
      const problem = await this.#persist();
      this.#setSnapshot({ pending: [], problem });
      return Object.freeze({ ok: true, commandId, sequence: this.#sequence });
    } catch (error) {
      const problem = normalizeProblem(error, "KERNEL_ERROR", false);
      this.#setSnapshot({ pending: [], problem });
      return failure(commandId, problem);
    }
  }

  async #persist(): Promise<SessionProblem | undefined> {
    try {
      await this.#repository.save({
        schemaVersion: 1,
        mode: "local",
        sessionId: this.#sessionId,
        updatedAt: this.#now(),
        payload: {
          kernel: this.#kernel.serialize(this.#state),
          sequence: this.#sequence,
        },
      });
      return undefined;
    } catch (error) {
      return normalizeProblem(error, "PERSISTENCE_FAILED", true);
    }
  }

  #setSnapshot(change: {
    pending: readonly string[];
    problem?: SessionProblem;
  }): void {
    this.#store.set(
      Object.freeze({
        lifecycle: "active",
        connectivity: "local",
        view: this.#kernel.project(this.#state),
        pending: Object.freeze([...change.pending]),
        lastSequence: this.#sequence,
        ...(change.problem ? { problem: change.problem } : {}),
      }),
    );
  }

  readonly dispose = (): void => {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#kernel.dispose?.();
    this.#store.dispose();
  };
}
