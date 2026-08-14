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

export type WxSocketEndpoint =
  | Readonly<{
    kind: "direct";
    url: string;
    header?: Readonly<Record<string, string>>;
  }>
  | Readonly<{
    kind: "cloudContainer";
    environmentId: string;
    serviceName: string;
    path: string;
  }>;

export class WxSocketTransport<TSend, TReceive> {
  private readonly listeners = new Set<(event: TransportEvent<TReceive>) => void>();
  private readonly endpoint: WxSocketEndpoint;
  private socket: WxSocketTask | null = null;
  private opened = false;
  private connecting = false;
  private disposed = false;
  private connectionGeneration = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  constructor(
    private readonly wx: WxLike,
    endpoint: WxSocketEndpoint | string,
    private readonly codec: JsonCodec<TSend, TReceive>,
    legacyDirectHeader: Readonly<Record<string, string>> = {},
  ) {
    this.endpoint = typeof endpoint === "string"
      ? { kind: "direct", url: endpoint, header: { ...legacyDirectHeader } }
      : endpoint.kind === "direct"
        ? { ...endpoint, header: { ...legacyDirectHeader, ...endpoint.header } }
        : endpoint;
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
    if (this.connecting) {
      this.connecting = false;
      this.connectionGeneration += 1;
    }
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
    if (this.disposed) return;
    this.disposed = true;
    this.connecting = false;
    this.connectionGeneration += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close({ code: 1000, reason: "client disposed" });
    this.socket = null;
    this.listeners.clear();
  }

  private connect(): void {
    if (this.disposed || this.socket || this.connecting) return;
    const generation = ++this.connectionGeneration;
    if (this.endpoint.kind === "direct") {
      try {
        this.attachSocket(this.wx.connectSocket({
          url: this.endpoint.url,
          header: { ...this.endpoint.header },
          timeout: 10000,
          protocols: ["exploding-kitty.v1"],
        }), generation);
      } catch (error) {
        this.handleConnectFailure(generation, error);
      }
      return;
    }

    const cloud = this.wx.cloud;
    if (!cloud) {
      this.handleConnectFailure(generation, new Error("WX_CLOUD_UNAVAILABLE"));
      return;
    }
    this.connecting = true;
    let connection;
    try {
      connection = cloud.connectContainer({
        config: { env: this.endpoint.environmentId },
        service: this.endpoint.serviceName,
        path: this.endpoint.path,
        timeout: 10_000,
      });
    } catch (error) {
      this.handleConnectFailure(generation, error);
      return;
    }
    void connection.then(
      ({ socketTask }) => {
        if (!socketTask) {
          this.handleConnectFailure(generation, new Error("CLOUD_SOCKET_TASK_UNAVAILABLE"));
          return;
        }
        this.attachSocket(socketTask, generation);
      },
      (error: unknown) => this.handleConnectFailure(generation, error),
    );
  }

  private attachSocket(socket: WxSocketTask, generation: number): void {
    if (this.disposed || generation !== this.connectionGeneration) {
      socket.close(this.disposed
        ? { code: 1000, reason: "client disposed" }
        : { code: 1012, reason: "stale connection" });
      return;
    }
    this.connecting = false;
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

  private handleConnectFailure(generation: number, error: unknown): void {
    if (this.disposed || generation !== this.connectionGeneration) return;
    this.connecting = false;
    this.opened = false;
    this.emit({ type: "closed", retrying: true, reason: connectionErrorMessage(error) });
    this.scheduleReconnect();
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
    if (this.disposed || this.opened || this.connecting || this.socket || this.reconnectTimer) return;
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

function connectionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const errMsg = (error as Record<string, unknown>).errMsg;
    if (typeof errMsg === "string" && errMsg) return errMsg;
  }
  return "socket connection failed";
}
