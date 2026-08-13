import type { ServerEnvelope } from "@exploding-kitty/protocol";
import type { MatchSnapshot } from "../model.js";
import { PROTOCOL_VERSION } from "@exploding-kitty/protocol";

export type OutboundConnection = Readonly<{
  playerId: string;
  sessionId: string;
  send(envelope: ServerEnvelope<MatchSnapshot>): void;
}>;

export class ConnectionHub {
  readonly #connections = new Map<string, Set<OutboundConnection>>();

  add(connection: OutboundConnection): () => void {
    const set = this.#connections.get(connection.playerId) ?? new Set();
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
}
