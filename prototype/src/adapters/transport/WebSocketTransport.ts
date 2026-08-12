import type { SessionTransport, TransportEvent } from "./public";

type WebSocketLike = Pick<
  WebSocket,
  | "readyState"
  | "send"
  | "close"
  | "addEventListener"
  | "removeEventListener"
>;

export type WebSocketTransportOptions = Readonly<{
  url: string | (() => string);
  createSocket?: (url: string) => WebSocketLike;
  encode?: (message: unknown) => string | ArrayBufferLike | Blob | ArrayBufferView;
  decode?: (data: unknown) => unknown;
  reconnect?: boolean;
  minReconnectMs?: number;
  maxReconnectMs?: number;
}>;

export class WebSocketTransport<TOutbound, TInbound>
  implements SessionTransport<TOutbound, TInbound>
{
  readonly #options: Required<
    Pick<WebSocketTransportOptions, "reconnect" | "minReconnectMs" | "maxReconnectMs">
  > &
    WebSocketTransportOptions;
  readonly #listeners = new Set<(event: TransportEvent<TInbound>) => void>();
  #socket: WebSocketLike | null = null;
  #attempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(options: WebSocketTransportOptions) {
    this.#options = {
      reconnect: true,
      minReconnectMs: 300,
      maxReconnectMs: 10_000,
      ...options,
    };
    this.#connect();
  }

  async send(message: TOutbound): Promise<void> {
    const socket = this.#socket;
    if (this.#disposed || !socket || socket.readyState !== 1) {
      throw new Error("WebSocket is not open");
    }
    const encode = this.#options.encode ?? JSON.stringify;
    socket.send(encode(message));
  }

  subscribe(listener: (event: TransportEvent<TInbound>) => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.close(1000, "session disposed");
    this.#socket = null;
    this.#listeners.clear();
  }

  #connect(): void {
    if (this.#disposed) return;
    const url = typeof this.#options.url === "function" ? this.#options.url() : this.#options.url;
    const create = this.#options.createSocket ?? ((value: string) => new WebSocket(value));
    let socket: WebSocketLike;
    try {
      socket = create(url);
    } catch (error) {
      this.#emit({ type: "fatal", error: toError(error) });
      return;
    }
    this.#socket = socket;
    socket.addEventListener("open", this.#handleOpen);
    socket.addEventListener("message", this.#handleMessage);
    socket.addEventListener("close", this.#handleClose);
    socket.addEventListener("error", this.#handleError);
  }

  readonly #handleOpen = () => {
    this.#attempt = 0;
    this.#emit({ type: "open" });
  };

  readonly #handleMessage = (event: Event) => {
    try {
      const data = (event as MessageEvent).data;
      const decode = this.#options.decode ?? defaultDecode;
      this.#emit({ type: "message", message: decode(data) as TInbound });
    } catch (error) {
      this.#emit({ type: "fatal", error: toError(error) });
    }
  };

  readonly #handleClose = (event: Event) => {
    const close = event as CloseEvent;
    this.#detachSocket();
    const retrying = !this.#disposed && this.#options.reconnect && close.code !== 1000;
    this.#emit({ type: "closed", retrying, reason: close.reason || undefined });
    if (retrying) this.#scheduleReconnect();
  };

  readonly #handleError = () => {
    // Browsers follow an error with close; close owns retry scheduling.
  };

  #scheduleReconnect(): void {
    this.#attempt += 1;
    const delay = Math.min(
      this.#options.maxReconnectMs,
      this.#options.minReconnectMs * 2 ** (this.#attempt - 1),
    );
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  #detachSocket(): void {
    const socket = this.#socket;
    if (!socket) return;
    socket.removeEventListener("open", this.#handleOpen);
    socket.removeEventListener("message", this.#handleMessage);
    socket.removeEventListener("close", this.#handleClose);
    socket.removeEventListener("error", this.#handleError);
    this.#socket = null;
  }

  #emit(event: TransportEvent<TInbound>): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}

function defaultDecode(data: unknown): unknown {
  return typeof data === "string" ? JSON.parse(data) : data;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
