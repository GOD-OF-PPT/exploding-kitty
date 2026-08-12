import type { SessionTransport, TransportEvent } from "./public";

export class FakeTransport<TOutbound, TInbound>
  implements SessionTransport<TOutbound, TInbound>
{
  readonly sent: TOutbound[] = [];
  readonly #listeners = new Set<(event: TransportEvent<TInbound>) => void>();
  #connected = false;
  #disposed = false;
  #nextFailure: Error | null = null;
  disposeCalls = 0;

  async send(message: TOutbound): Promise<void> {
    if (this.#disposed) throw new Error("Transport is disposed");
    if (!this.#connected) throw new Error("Transport is not connected");
    if (this.#nextFailure) {
      const error = this.#nextFailure;
      this.#nextFailure = null;
      throw error;
    }
    this.sent.push(structuredClone(message));
  }

  subscribe(listener: (event: TransportEvent<TInbound>) => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  open(): void {
    if (this.#disposed) return;
    this.#connected = true;
    this.#emit({ type: "open" });
  }

  message(message: TInbound): void {
    if (this.#disposed) return;
    this.#emit({ type: "message", message });
  }

  close(retrying = false, reason?: string): void {
    if (this.#disposed) return;
    this.#connected = false;
    this.#emit({ type: "closed", retrying, reason });
  }

  fatal(error: Error): void {
    if (this.#disposed) return;
    this.#connected = false;
    this.#emit({ type: "fatal", error });
  }

  failNext(error: Error): void {
    this.#nextFailure = error;
  }

  clearSent(): void {
    this.sent.length = 0;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#connected = false;
    this.disposeCalls += 1;
    this.#listeners.clear();
  }

  #emit(event: TransportEvent<TInbound>): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
