import type { ServerEnvelope } from "@exploding-kitty/protocol";
import type { MatchSnapshot } from "../model.js";
import { PROTOCOL_VERSION } from "@exploding-kitty/protocol";

export type OutboundConnection = Readonly<{
  playerId: string;
  sessionId: string;
  send(envelope: ServerEnvelope<MatchSnapshot>): void;
  /** Called by the hub when this connection is evicted to enforce the per-playerId cap. */
  close(code?: number, reason?: string): void;
}>;

export type ConnectionHubOptions = Readonly<{
  /** Maximum concurrent connections per playerId. Default: 3. */
  cap?: number;
  /** Maximum commands per throttle window per playerId. Default: 30. */
  throttleLimit?: number;
  /** Throttle window duration in milliseconds. Default: 1000 (1 second). */
  throttleWindowMs?: number;
}>;

/**
 * Manages WebSocket connections and per-playerId rate limiting.
 *
 * - **Connection cap**: When a new connection for a playerId would exceed the
 *   cap, the oldest existing connection for that player is closed (evicted)
 *   before the new one is added. The set size never exceeds the cap.
 *
 * - **Cross-connection throttle**: A per-playerId command counter that
 *   survives socket reconnects. A new socket does not get a fresh budget.
 */
export class ConnectionHub {
  readonly #connections = new Map<string, Set<OutboundConnection>>();
  readonly #cap: number;
  readonly #throttleLimit: number;
  readonly #throttleWindowMs: number;
  readonly #throttle = new Map<string, { count: number; windowStart: number }>();

  constructor(options?: ConnectionHubOptions) {
    this.#cap = options?.cap ?? 3;
    this.#throttleLimit = options?.throttleLimit ?? 30;
    this.#throttleWindowMs = options?.throttleWindowMs ?? 1_000;
  }

  add(connection: OutboundConnection): () => void {
    const set = this.#connections.get(connection.playerId) ?? new Set();
    // Evict oldest connections until there is room for the new one.
    while (set.size >= this.#cap) {
      const oldest = set.values().next().value;
      if (!oldest) break;
      set.delete(oldest);
      oldest.close(1008, "connection replaced");
    }
    set.add(connection);
    this.#connections.set(connection.playerId, set);
    return () => {
      set.delete(connection);
      if (set.size === 0) this.#connections.delete(connection.playerId);
    };
  }

  hasConnections(playerId: string): boolean {
    return (this.#connections.get(playerId)?.size ?? 0) > 0;
  }

  /** Returns the number of active connections for a playerId. */
  connectionCount(playerId: string): number {
    return this.#connections.get(playerId)?.size ?? 0;
  }

  send(playerId: string, envelope: ServerEnvelope<MatchSnapshot>): void {
    for (const connection of this.#connections.get(playerId) ?? []) connection.send(envelope);
  }

  sendSnapshot(playerId: string, revision: number, snapshot: MatchSnapshot): void {
    for (const connection of this.#connections.get(playerId) ?? []) {
      connection.send({
        type: "snapshot",
        protocolVersion: PROTOCOL_VERSION,
        sessionId: connection.sessionId,
        revision,
        snapshot,
      });
    }
  }

  /**
   * Attempts to acquire a command slot for the given playerId. Returns true if
   * the command is allowed (within the per-second limit), false if it should be
   * rejected. The counter is keyed by playerId, so it persists across socket
   * reconnects — a new socket does not get a fresh budget.
   */
  tryAcquire(playerId: string): boolean {
    const now = Date.now();
    let entry = this.#throttle.get(playerId);
    if (!entry || now - entry.windowStart >= this.#throttleWindowMs) {
      entry = { count: 0, windowStart: now };
      this.#throttle.set(playerId, entry);
    }
    return ++entry.count <= this.#throttleLimit;
  }
}
