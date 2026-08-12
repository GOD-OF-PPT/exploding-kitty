import {
  isStoredSession,
  type SessionRepository,
  type StorageLike,
  type StoredSession,
} from "./public";

export type BrowserSessionRepositoryOptions = Readonly<{
  prefix?: string;
}>;

export class BrowserSessionRepository implements SessionRepository {
  readonly #storage: StorageLike;
  readonly #prefix: string;

  constructor(
    storage: StorageLike = browserStorage(),
    options: BrowserSessionRepositoryOptions = {},
  ) {
    this.#storage = storage;
    this.#prefix = options.prefix ?? "ek:";
  }

  async load(sessionId: string): Promise<StoredSession | null> {
    const serialized = this.#storage.getItem(this.#key(sessionId));
    if (serialized === null) return null;
    try {
      const value: unknown = JSON.parse(serialized);
      return isStoredSession(value) && value.sessionId === sessionId ? value : null;
    } catch {
      return null;
    }
  }

  async save(value: StoredSession): Promise<void> {
    this.#storage.setItem(this.#key(value.sessionId), JSON.stringify(value));
  }

  async remove(sessionId: string): Promise<void> {
    this.#storage.removeItem(this.#key(sessionId));
  }

  #key(sessionId: string): string {
    return `${this.#prefix}${sessionId}`;
  }
}

function browserStorage(): StorageLike {
  if (typeof globalThis.localStorage === "undefined") {
    throw new Error("BrowserSessionRepository requires localStorage or an injected StorageLike");
  }
  return globalThis.localStorage;
}
