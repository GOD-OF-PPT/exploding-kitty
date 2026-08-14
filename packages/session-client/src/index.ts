import {
  PROTOCOL_VERSION,
  makeCommandEnvelope,
  makeResumeEnvelope,
  parseClientAction,
  type ClientAction,
  type ClientCommandEnvelope,
  type ClientEnvelope,
  type ServerEnvelope,
  type WireProblem,
} from "@exploding-kitty/protocol";

export type SessionLifecycle = "opening" | "active" | "recovering" | "ended" | "failed";
export type SessionConnectivity = "local" | "connecting" | "online" | "offline";
export type SessionProblem = WireProblem;

export type SessionSnapshot<TView = unknown> = Readonly<{
  lifecycle: SessionLifecycle;
  connectivity: SessionConnectivity;
  view: TView | null;
  /** Revision of the view currently exposed, not a domain event sequence. */
  revision: number;
  pendingCommandId?: string;
  problem?: SessionProblem;
}>;

export type SendResult =
  | Readonly<{ ok: true; commandId: string; revision: number }>
  | Readonly<{ ok: false; commandId: string; code: string; message: string; retryable: boolean }>;

export interface GameSession<TView = unknown> {
  readonly getSnapshot: () => SessionSnapshot<TView>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly send: (action: ClientAction) => Promise<SendResult>;
  readonly dispose: () => void;
}

export type StoredSession<TPayload = unknown> = Readonly<{
  schemaVersion: 1;
  mode: "local" | "remote";
  sessionId: string;
  updatedAt: number;
  payload: TPayload;
}>;

export interface SessionRepository {
  load(sessionId: string): Promise<StoredSession | null>;
  save(value: StoredSession): Promise<void>;
  remove(sessionId: string): Promise<void>;
}

export type TransportEvent<TInbound> =
  | Readonly<{ type: "open" }>
  | Readonly<{ type: "message"; message: TInbound }>
  | Readonly<{ type: "closed"; retrying: boolean; reason?: string }>
  | Readonly<{ type: "fatal"; error: Error }>;

export interface SessionTransport<TOutbound, TInbound> {
  send(message: TOutbound): Promise<void>;
  subscribe(listener: (event: TransportEvent<TInbound>) => void): () => void;
  dispose(): void;
}

class ExternalStore<T> {
  #value: T;
  readonly #listeners = new Set<() => void>();
  #disposed = false;

  constructor(value: T) { this.#value = value; }
  readonly getSnapshot = (): T => this.#value;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  set(value: T): void {
    if (this.#disposed || Object.is(value, this.#value)) return;
    this.#value = value;
    for (const listener of [...this.#listeners]) listener();
  }
  dispose(): void { this.#disposed = true; this.#listeners.clear(); }
}

const makeId = (): string => `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const asProblem = (error: unknown, code: string, retryable: boolean): SessionProblem => ({
  code,
  message: error instanceof Error ? error.message : String(error),
  retryable,
});
const failure = (commandId: string, problem: SessionProblem): SendResult => ({ ok: false, commandId, ...problem });

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}

export class MemorySessionRepository implements SessionRepository {
  readonly #values = new Map<string, StoredSession>();
  constructor(initial: Iterable<StoredSession> = []) {
    for (const item of initial) this.#values.set(item.sessionId, clone(item));
  }
  async load(sessionId: string): Promise<StoredSession | null> { return clone(this.#values.get(sessionId) ?? null); }
  async save(value: StoredSession): Promise<void> { this.#values.set(value.sessionId, clone(value)); }
  async remove(sessionId: string): Promise<void> { this.#values.delete(sessionId); }
}

/** Controllable transport fake shared by unit tests and composition smoke tests. */
export class MemoryTransport<TOutbound, TInbound> implements SessionTransport<TOutbound, TInbound> {
  readonly sent: TOutbound[] = [];
  readonly #listeners = new Set<(event: TransportEvent<TInbound>) => void>();
  #open = false;
  #disposed = false;
  #nextFailure?: Error;
  disposeCalls = 0;

  async send(message: TOutbound): Promise<void> {
    if (this.#disposed) throw new Error("TRANSPORT_DISPOSED");
    if (!this.#open) throw new Error("TRANSPORT_OFFLINE");
    if (this.#nextFailure) { const error = this.#nextFailure; this.#nextFailure = undefined; throw error; }
    this.sent.push(clone(message));
  }
  subscribe(listener: (event: TransportEvent<TInbound>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  open(): void { this.#open = true; this.#emit({ type: "open" }); }
  message(message: TInbound): void { this.#emit({ type: "message", message }); }
  close(retrying = false, reason?: string): void { this.#open = false; this.#emit({ type: "closed", retrying, ...(reason ? { reason } : {}) }); }
  fatal(error: Error): void { this.#open = false; this.#emit({ type: "fatal", error }); }
  failNext(error: Error): void { this.#nextFailure = error; }
  clearSent(): void { this.sent.length = 0; }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.#open = false; this.disposeCalls += 1; this.#listeners.clear(); }
  #emit(event: TransportEvent<TInbound>): void { if (!this.#disposed) for (const listener of [...this.#listeners]) listener(event); }
}

/** @deprecated MemoryTransport is the production-facing test-double name. */
export const FakeTransport = MemoryTransport;

export type LocalKernelResult<TState> =
  | Readonly<{ ok: true; state: TState }>
  | Readonly<{ ok: false; state: TState; problem: SessionProblem }>;

export interface LocalKernelAdapter<TState, TView> {
  create(): TState | Promise<TState>;
  restore(payload: unknown): TState | Promise<TState>;
  execute(state: TState, command: ClientCommandEnvelope): LocalKernelResult<TState> | Promise<LocalKernelResult<TState>>;
  project(state: TState): TView;
  serialize(state: TState): unknown;
  dispose?(): void;
}

type LocalPayload = Readonly<{ kernel: unknown; revision: number }>;
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
  #revision: number;
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;

  private constructor(options: LocalGameSessionOptions<TState, TView>, state: TState, revision: number) {
    this.#sessionId = options.sessionId; this.#kernel = options.kernel; this.#repository = options.repository;
    this.#commandId = options.commandId ?? makeId; this.#now = options.now ?? Date.now;
    this.#state = state; this.#revision = revision;
    this.#store = new ExternalStore(Object.freeze({ lifecycle: "active", connectivity: "local", view: this.#kernel.project(state), revision }));
    this.getSnapshot = this.#store.getSnapshot; this.subscribe = this.#store.subscribe;
  }

  static async open<TState, TView>(options: LocalGameSessionOptions<TState, TView>): Promise<LocalGameSession<TState, TView>> {
    let payload: LocalPayload | undefined;
    try {
      const stored = await options.repository.load(options.sessionId);
      if (stored?.mode === "local") payload = stored.payload as LocalPayload;
    } catch { /* Local play can start even if cache recovery is unavailable. */ }
    const state = payload ? await options.kernel.restore(payload.kernel) : await options.kernel.create();
    return new LocalGameSession(options, state, payload?.revision ?? 0);
  }

  readonly send = (rawAction: ClientAction): Promise<SendResult> => {
    const commandId = this.#commandId();
    if (this.#disposed) return Promise.resolve(failure(commandId, { code: "SESSION_DISPOSED", message: "Session is disposed", retryable: false }));
    const task = this.#queue.then(() => this.#execute(rawAction, commandId));
    this.#queue = task.then(() => undefined, () => undefined);
    return task;
  };

  async #execute(rawAction: ClientAction, commandId: string): Promise<SendResult> {
    if (this.#disposed) return failure(commandId, { code: "SESSION_DISPOSED", message: "Session is disposed", retryable: false });
    let action: ClientAction;
    try { action = parseClientAction(rawAction); }
    catch (error) { return failure(commandId, asProblem(error, "INVALID_ACTION", false)); }
    this.#publish({ pendingCommandId: commandId });
    try {
      const command = makeCommandEnvelope(this.#sessionId, commandId, this.#revision, action);
      const result = await this.#kernel.execute(this.#state, command);
      this.#state = result.state;
      if (!result.ok) { this.#publish({ problem: result.problem }); return failure(commandId, result.problem); }
      this.#revision += 1;
      const persistenceProblem = await this.#persist();
      this.#publish(persistenceProblem ? { problem: persistenceProblem } : {});
      return { ok: true, commandId, revision: this.#revision };
    } catch (error) {
      const problem = asProblem(error, "LOCAL_KERNEL_ERROR", false); this.#publish({ problem }); return failure(commandId, problem);
    }
  }

  async #persist(): Promise<SessionProblem | undefined> {
    try {
      await this.#repository.save({ schemaVersion: 1, mode: "local", sessionId: this.#sessionId, updatedAt: this.#now(), payload: { kernel: this.#kernel.serialize(this.#state), revision: this.#revision } satisfies LocalPayload });
      return undefined;
    } catch (error) { return asProblem(error, "PERSISTENCE_FAILED", true); }
  }
  #publish(change: { pendingCommandId?: string; problem?: SessionProblem }): void {
    this.#store.set(Object.freeze({ lifecycle: "active", connectivity: "local", view: this.#kernel.project(this.#state), revision: this.#revision, ...(change.pendingCommandId ? { pendingCommandId: change.pendingCommandId } : {}), ...(change.problem ? { problem: change.problem } : {}) }));
  }
  readonly dispose = (): void => { if (this.#disposed) return; this.#disposed = true; this.#kernel.dispose?.(); this.#store.dispose(); };
}

export const createLocalSession = <TState, TView>(options: LocalGameSessionOptions<TState, TView>): Promise<LocalGameSession<TState, TView>> => LocalGameSession.open(options);

type RemotePayload<TView> = Readonly<{
  revision: number;
  commandRevision: number;
  view: TView | null;
  resumeToken?: string;
  outbox?: ClientCommandEnvelope;
}>;

export type RemoteGameSessionOptions<TView> = Readonly<{
  sessionId: string;
  transport: SessionTransport<ClientEnvelope, ServerEnvelope<TView>>;
  repository: SessionRepository;
  /** Fresh credential used by the first resume after login; it supersedes any cached token. */
  initialResumeToken?: string;
  commandId?: () => string;
  now?: () => number;
  ackTimeoutMs?: number;
}>;

type Awaiting = { commandId: string; resolve: (result: SendResult) => void; timer: ReturnType<typeof setTimeout> };

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
  #view: TView | null;
  #revision: number;
  #commandRevision: number;
  #resumeToken?: string;
  #outbox?: ClientCommandEnvelope;
  #outboxWaiters: Array<() => void> = [];
  #snapshotRequestedAfterAck = false;
  #awaiting?: Awaiting;
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;

  private constructor(options: RemoteGameSessionOptions<TView>, payload: RemotePayload<TView>) {
    this.#sessionId = options.sessionId; this.#transport = options.transport; this.#repository = options.repository;
    this.#commandId = options.commandId ?? makeId; this.#now = options.now ?? Date.now; this.#ackTimeoutMs = options.ackTimeoutMs ?? 10_000;
    this.#view = payload.view; this.#revision = payload.revision; this.#commandRevision = Math.max(payload.commandRevision, payload.revision);
    this.#resumeToken = options.initialResumeToken ?? payload.resumeToken; this.#outbox = payload.outbox;
    this.#store = new ExternalStore(Object.freeze({ lifecycle: "recovering", connectivity: "connecting", view: this.#view, revision: this.#revision, ...(this.#outbox ? { pendingCommandId: this.#outbox.commandId } : {}) }));
    this.getSnapshot = this.#store.getSnapshot; this.subscribe = this.#store.subscribe;
    this.#unsubscribe = this.#transport.subscribe((event) => this.#onTransport(event));
  }

  static async open<TView>(options: RemoteGameSessionOptions<TView>): Promise<RemoteGameSession<TView>> {
    let payload: RemotePayload<TView> = { revision: 0, commandRevision: 0, view: null };
    try {
      const stored = await options.repository.load(options.sessionId);
      if (stored?.mode === "remote") payload = stored.payload as RemotePayload<TView>;
    } catch { /* The server remains authoritative when cache is unavailable. */ }
    return new RemoteGameSession(options, payload);
  }

  readonly send = (rawAction: ClientAction): Promise<SendResult> => {
    const commandId = this.#commandId();
    if (this.#disposed) return Promise.resolve(failure(commandId, { code: "SESSION_DISPOSED", message: "Session is disposed", retryable: false }));
    const task = this.#queue.then(() => this.#sendOne(rawAction, commandId));
    this.#queue = task.then(() => undefined, () => undefined);
    return task;
  };

  async #sendOne(rawAction: ClientAction, commandId: string): Promise<SendResult> {
    if (this.#outbox) await new Promise<void>((resolve) => this.#outboxWaiters.push(resolve));
    if (this.#disposed) return failure(commandId, { code: "SESSION_DISPOSED", message: "Session is disposed", retryable: false });
    let action: ClientAction;
    try { action = parseClientAction(rawAction); }
    catch (error) { return failure(commandId, asProblem(error, "INVALID_ACTION", false)); }
    this.#outbox = makeCommandEnvelope(this.#sessionId, commandId, this.#commandRevision, action);
    this.#publish({ problem: undefined });
    try { await this.#persist(); }
    catch (error) { this.#clearOutbox(); const problem = asProblem(error, "OUTBOX_PERSISTENCE_FAILED", true); this.#publish({ problem }); return failure(commandId, problem); }
    try { await this.#transport.send(this.#outbox); }
    catch (error) { const problem = asProblem(error, "TRANSPORT_SEND_FAILED", true); this.#publish({ problem }); return failure(commandId, problem); }
    return new Promise<SendResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.#awaiting?.commandId !== commandId) return;
        this.#awaiting = undefined;
        const problem = { code: "COMMAND_TIMEOUT", message: "The server did not acknowledge the command", retryable: true } as const;
        this.#publish({ problem }); resolve(failure(commandId, problem));
      }, this.#ackTimeoutMs);
      this.#awaiting = { commandId, resolve, timer };
    });
  }

  #onTransport(event: TransportEvent<ServerEnvelope<TView>>): void {
    if (this.#disposed) return;
    if (event.type === "open") { this.#publish({ lifecycle: this.#view ? "recovering" : "opening", connectivity: "online", problem: undefined }); void this.#resumeAndReplay(); return; }
    if (event.type === "closed") { this.#publish({ lifecycle: "recovering", connectivity: event.retrying ? "connecting" : "offline", problem: { code: "TRANSPORT_CLOSED", message: event.reason ?? "Connection closed", retryable: event.retrying } }); return; }
    if (event.type === "fatal") { const problem = asProblem(event.error, "TRANSPORT_FATAL", false); this.#publish({ lifecycle: "failed", connectivity: "offline", problem }); this.#settleAwaiting(failure(this.#awaiting?.commandId ?? "transport", problem)); return; }
    this.#onMessage(event.message);
  }

  async #resumeAndReplay(): Promise<void> {
    try {
      await this.#transport.send(makeResumeEnvelope(this.#sessionId, this.#revision, this.#resumeToken));
      if (this.#outbox) await this.#transport.send(this.#outbox);
    } catch (error) { this.#publish({ lifecycle: "recovering", connectivity: "connecting", problem: asProblem(error, "RESUME_FAILED", true) }); }
  }

  #onMessage(message: ServerEnvelope<TView>): void {
    if (message.sessionId !== this.#sessionId) return;
    if (message.type === "snapshot") {
      if (message.revision < this.#revision) return;
      this.#revision = message.revision; this.#commandRevision = Math.max(this.#commandRevision, message.revision);
      this.#view = message.snapshot; this.#resumeToken = message.resumeToken ?? this.#resumeToken;
      this.#snapshotRequestedAfterAck = false;
      this.#publish({ lifecycle: "active", connectivity: "online", problem: undefined }); void this.#persist().catch((error) => this.#publish({ problem: asProblem(error, "PERSISTENCE_FAILED", true) }));
      return;
    }
    if (!this.#outbox || message.commandId !== this.#outbox.commandId) return;
    if (message.ok) {
      this.#commandRevision = Math.max(this.#commandRevision, message.revision);
      const result: SendResult = { ok: true, commandId: message.commandId, revision: message.revision };
      const snapshotMissing = message.revision > this.#revision;
      this.#clearOutbox(); this.#publish({ lifecycle: "active", connectivity: "online", problem: undefined }); void this.#persist(); this.#settleAwaiting(result);
      if (snapshotMissing && !this.#snapshotRequestedAfterAck) {
        this.#snapshotRequestedAfterAck = true;
        void this.#transport.send(makeResumeEnvelope(this.#sessionId, this.#revision, this.#resumeToken))
          .catch((error) => this.#publish({ lifecycle: "recovering", connectivity: "connecting", problem: asProblem(error, "SNAPSHOT_REFRESH_FAILED", true) }));
      }
    } else {
      const result = failure(message.commandId, message.problem);
      this.#clearOutbox(); this.#publish({ problem: message.problem }); void this.#persist(); this.#settleAwaiting(result);
    }
  }

  async #persist(): Promise<void> {
    await this.#repository.save({ schemaVersion: 1, mode: "remote", sessionId: this.#sessionId, updatedAt: this.#now(), payload: {
      revision: this.#revision, commandRevision: this.#commandRevision, view: this.#view,
      ...(this.#resumeToken ? { resumeToken: this.#resumeToken } : {}), ...(this.#outbox ? { outbox: this.#outbox } : {}),
    } satisfies RemotePayload<TView> });
  }
  #clearOutbox(): void { this.#outbox = undefined; for (const resolve of this.#outboxWaiters.splice(0)) resolve(); }
  #settleAwaiting(result: SendResult): void { const awaiting = this.#awaiting; if (!awaiting || awaiting.commandId !== result.commandId) return; this.#awaiting = undefined; clearTimeout(awaiting.timer); awaiting.resolve(result); }
  #publish(change: { lifecycle?: SessionLifecycle; connectivity?: SessionConnectivity; problem?: SessionProblem }): void {
    const current = this.#store.getSnapshot();
    this.#store.set(Object.freeze({ lifecycle: change.lifecycle ?? current.lifecycle, connectivity: change.connectivity ?? current.connectivity, view: this.#view, revision: this.#revision, ...(this.#outbox ? { pendingCommandId: this.#outbox.commandId } : {}), ...(change.problem ? { problem: change.problem } : {}) }));
  }
  readonly dispose = (): void => {
    if (this.#disposed) return; this.#disposed = true;
    this.#settleAwaiting(failure(this.#awaiting?.commandId ?? "dispose", { code: "SESSION_DISPOSED", message: "Session is disposed", retryable: false }));
    for (const resolve of this.#outboxWaiters.splice(0)) resolve(); this.#unsubscribe(); this.#transport.dispose(); this.#store.dispose();
  };
}

export const createRemoteSession = <TView>(options: RemoteGameSessionOptions<TView>): Promise<RemoteGameSession<TView>> => RemoteGameSession.open(options);

export { PROTOCOL_VERSION };
export type { ClientAction, ClientEnvelope, ServerEnvelope };
