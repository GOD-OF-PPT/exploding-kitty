import type { SessionRepository, StoredSession } from "./public";

export class MemorySessionRepository implements SessionRepository {
  readonly #sessions = new Map<string, StoredSession>();

  constructor(initial: Iterable<StoredSession> = []) {
    for (const session of initial) {
      this.#sessions.set(session.sessionId, clone(session));
    }
  }

  async load(sessionId: string): Promise<StoredSession | null> {
    const value = this.#sessions.get(sessionId);
    return value ? clone(value) : null;
  }

  async save(value: StoredSession): Promise<void> {
    this.#sessions.set(value.sessionId, clone(value));
  }

  async remove(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
