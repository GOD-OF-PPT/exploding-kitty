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

/** The subset shared by localStorage and small test doubles. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredSession>;
  return (
    item.schemaVersion === 1 &&
    (item.mode === "local" || item.mode === "remote") &&
    typeof item.sessionId === "string" &&
    typeof item.updatedAt === "number" &&
    "payload" in item
  );
}
