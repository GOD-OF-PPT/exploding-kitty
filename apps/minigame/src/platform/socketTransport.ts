import type { WxLike, WxSocketTask } from "./wx";

export type TransportEvent<T> =
  | Readonly<{ type: "open" }>
  | Readonly<{ type: "message"; message: T }>
  | Readonly<{ type: "closed"; retrying: boolean; reason?: string }>
  | Readonly<{ type: "fatal"; error: Error }>;

export interface JsonCodec<TSend, TReceive> {
  encode(value: TSend): string;
  decode(value: string): TReceive;
}

export class WxSocketTransport<TSend, TReceive> {
  private readonly listeners = new Set<(event: TransportEvent<TReceive>) => void>();
  private socket: WxSocketTask | null = null;
  private opened = false;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  constructor(
    private readonly wx: WxLike,
    private readonly url: string,
    private readonly codec: JsonCodec<TSend, TReceive>,
    private readonly header: Readonly<Record<string, string>> = {},
  ) {
    this.connect();
  }

  async send(message: TSend): Promise<void> {
    if (this.disposed) throw new Error("TRANSPORT_DISPOSED");
    if (!this.opened || !this.socket) throw new Error("TRANSPORT_OFFLINE");
    return this.sendNow(message);
  }

  subscribe(listener: (event: TransportEvent<TReceive>) => void): () => void {
    this.listeners.add(listener);
    if (this.opened) void Promise.resolve().then(() => {
      if (!this.disposed && this.listeners.has(listener)) listener({ type: "open" });
    });
    return () => this.listeners.delete(listener);
  }

  reconnect(): void {
    if (this.disposed || this.opened) return;
    if (this.socket) {
      const stale = this.socket;
      this.socket = null;
      stale.close({ code: 1012, reason: "manual reconnect" });
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close({ code: 1000, reason: "client disposed" });
    this.socket = null;
    this.listeners.clear();
  }

  private connect(): void {
    if (this.disposed || this.socket) return;
    const socket = this.wx.connectSocket({
      url: this.url,
      header: { ...this.header },
      timeout: 10000,
      protocols: ["exploding-kitty.v1"],
    });
    this.socket = socket;
    socket.onOpen(() => {
      if (this.disposed || this.socket !== socket) return;
      this.opened = true;
      this.reconnectAttempts = 0;
      this.emit({ type: "open" });
    });
    socket.onMessage(({ data }) => {
      if (this.disposed || this.socket !== socket) return;
      if (typeof data !== "string") {
        this.failSocket(socket, "UNSUPPORTED_BINARY_MESSAGE", "unsupported binary server message");
        return;
      }
      try {
        this.emit({ type: "message", message: this.codec.decode(data) });
      } catch {
        this.failSocket(socket, "INVALID_SERVER_MESSAGE", "invalid server message");
      }
    });
    socket.onClose(({ code, reason }) => {
      if (this.socket !== socket) return;
      this.opened = false;
      this.socket = null;
      const retrying = !this.disposed && code !== 1000;
      this.emit({ type: "closed", retrying, reason });
      if (retrying) this.scheduleReconnect();
    });
    socket.onError(() => {
      if (this.socket !== socket || this.disposed) return;
      this.opened = false;
      this.socket = null;
      socket.close({ code: 1011, reason: "socket error" });
      this.emit({ type: "closed", retrying: true, reason: "socket connection error" });
      this.scheduleReconnect();
    });
  }

  private sendNow(message: TSend): Promise<void> {
    const socket = this.socket;
    if (!socket || !this.opened) return Promise.reject(new Error("TRANSPORT_OFFLINE"));
    return new Promise((resolve, reject) => socket.send({
      data: this.codec.encode(message), success: resolve,
      fail: () => {
        const error = new Error("socket send failed");
        if (this.socket === socket) {
          this.opened = false;
          this.socket = null;
          socket.close({ code: 1011, reason: "socket send failed" });
          this.emit({ type: "closed", retrying: true, reason: error.message });
          this.scheduleReconnect();
        }
        reject(error);
      },
    }));
  }

  private emit(event: TransportEvent<TReceive>): void {
    for (const listener of this.listeners) listener(event);
  }

  private failSocket(socket: WxSocketTask, code: string, message: string): void {
    if (this.socket !== socket || this.disposed) return;
    this.opened = false;
    this.socket = null;
    socket.close({ code: 1003, reason: code });
    const error = new Error(message); error.name = code;
    this.emit({ type: "fatal", error });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.opened || this.socket || this.reconnectTimer) return;
    const delay = Math.min(8_000, 500 * 2 ** Math.min(this.reconnectAttempts++, 4));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnect();
    }, delay);
  }
}

export function createJsonCodec<TSend, TReceive>(parse: (input: unknown) => TReceive): JsonCodec<TSend, TReceive> {
  return {
    encode: (value) => JSON.stringify(value),
    decode: (value) => parse(JSON.parse(value) as unknown),
  };
}

export function toWebSocketUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "");
  return `${base}/v1/session`;
}
