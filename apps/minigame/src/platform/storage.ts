import type { WxLike } from "./wx";

type StorageLike = Pick<WxLike, "getStorageSync" | "setStorageSync" | "removeStorageSync">;

export type DevelopmentIdentity = Readonly<{
  schemaVersion: 1;
  deviceId: string;
  displayName: string;
}>;

export const DEVELOPMENT_IDENTITY_KEY = "ek.development-identity.v1";

/**
 * Persists an installation-scoped identity for the explicitly enabled development login.
 * The opaque device id is sent separately from the display-only friendly name.
 */
export class WxDevelopmentIdentityRepository {
  constructor(
    private readonly storage: StorageLike,
    private readonly createDeviceId: () => string = createDevelopmentDeviceId,
    private readonly key = DEVELOPMENT_IDENTITY_KEY,
  ) {}

  getOrCreate(): DevelopmentIdentity {
    const stored = this.storage.getStorageSync(this.key);
    const storedDeviceId = developmentDeviceId(stored);
    if (storedDeviceId) {
      const canonical = developmentIdentity(storedDeviceId);
      // Migrate the earlier dev:<hex> display-name representation without rotating deviceId.
      if (!isDevelopmentIdentity(stored) || stored.displayName !== canonical.displayName) this.storage.setStorageSync(this.key, canonical);
      return canonical;
    }
    const deviceId = this.createDeviceId().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(deviceId)) throw new Error("INVALID_DEVELOPMENT_DEVICE_ID");
    const identity = developmentIdentity(deviceId);
    // Do not silently continue with an ephemeral identity: persistence is what makes room
    // membership and session recovery reliable across launches.
    this.storage.setStorageSync(this.key, identity);
    return identity;
  }
}

export function createDevelopmentDeviceId(): string {
  const bytes = new Uint8Array(16);
  let populated = false;
  try {
    const crypto = globalThis.crypto;
    if (crypto?.getRandomValues) {
      crypto.getRandomValues(bytes);
      populated = true;
    }
  } catch { /* Some mini-game runtimes expose globalThis.crypto incompletely. */ }
  if (!populated) {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    // Mix wall-clock bits into the fallback so independently seeded runtimes started at
    // different times cannot accidentally produce the same installation id.
    let timestamp = Date.now();
    for (let index = bytes.length - 1; index >= bytes.length - 6; index -= 1) {
      bytes[index] = bytes[index]! ^ (timestamp % 256);
      timestamp = Math.floor(timestamp / 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export type PersistedSession<T = unknown> = Readonly<{ schemaVersion: 1; mode: "local" | "remote"; sessionId: string; updatedAt: number; payload: T }>;

export class WxSessionRepository<T = unknown> {
  constructor(private readonly wx: Pick<WxLike, "getStorageSync" | "setStorageSync" | "removeStorageSync">, private readonly key = "ek.session.v1") {}

  async load(sessionId: string): Promise<PersistedSession<T> | null> {
    const value = this.wx.getStorageSync(`${this.key}.${sessionId}`);
    return isPersistedSession<T>(value) ? value : null;
  }

  async save(value: PersistedSession<T>): Promise<void> {
    this.wx.setStorageSync(`${this.key}.${value.sessionId}`, value);
  }

  async remove(sessionId: string): Promise<void> {
    this.wx.removeStorageSync(`${this.key}.${sessionId}`);
  }
}

export class WxOutbox {
  constructor(private readonly wx: Pick<WxLike, "getStorageSync" | "setStorageSync" | "removeStorageSync">, private readonly key = "ek.outbox.v1") {}

  read<T>(): readonly T[] {
    const value = this.wx.getStorageSync(this.key);
    return Array.isArray(value) ? value as T[] : [];
  }

  replace<T>(messages: readonly T[]): void {
    if (messages.length === 0) this.wx.removeStorageSync(this.key);
    else this.wx.setStorageSync(this.key, [...messages]);
  }
}

function isPersistedSession<T>(value: unknown): value is PersistedSession<T> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && (record.mode === "local" || record.mode === "remote") && typeof record.sessionId === "string" && typeof record.updatedAt === "number" && "payload" in record;
}

function isDevelopmentIdentity(value: unknown): value is DevelopmentIdentity {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.deviceId === "string"
    && /^[0-9a-f]{32}$/.test(record.deviceId)
    && record.displayName === developmentDisplayName(record.deviceId);
}

function developmentDeviceId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const deviceId = (value as Record<string, unknown>).deviceId;
  return typeof deviceId === "string" && /^[0-9a-f]{32}$/.test(deviceId) ? deviceId : null;
}

function developmentIdentity(deviceId: string): DevelopmentIdentity {
  return { schemaVersion: 1, deviceId, displayName: developmentDisplayName(deviceId) };
}

function developmentDisplayName(deviceId: string): string {
  return `开发玩家 ${deviceId.slice(-4).toUpperCase()}`;
}
