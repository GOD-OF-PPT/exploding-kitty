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
