import type { WxLike } from "./wx";

export type AppLifecycleEvent = Readonly<{ type: "foreground" | "background"; query?: Record<string, string> }>;
export type NetworkState = Readonly<{ connected: boolean; type: string }>;

export class WxLifecycleAdapter {
  private readonly listeners = new Set<(event: AppLifecycleEvent) => void>();
  private readonly show = (options?: Record<string, unknown>) => this.emit({
    type: "foreground",
    ...(isStringRecord(options?.query) ? { query: options.query } : {}),
  });
  private readonly hide = () => this.emit({ type: "background" });

  constructor(private readonly wx: WxLike) {
    wx.onShow(this.show);
    wx.onHide(this.hide);
  }

  subscribe(listener: (event: AppLifecycleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.wx.offShow?.(this.show);
    this.wx.offHide?.(this.hide);
    this.listeners.clear();
  }

  private emit(event: AppLifecycleEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
}

export class WxNetworkAdapter {
  private readonly listeners = new Set<(state: NetworkState) => void>();
  private current: NetworkState = { connected: true, type: "unknown" };
  private readonly changed = (event: { isConnected: boolean; networkType: string }) => {
    this.current = { connected: event.isConnected, type: event.networkType };
    for (const listener of this.listeners) listener(this.current);
  };

  constructor(private readonly wx: WxLike) {
    wx.onNetworkStatusChange(this.changed);
    wx.getNetworkType({ success: ({ networkType }) => { this.current = { connected: networkType !== "none", type: networkType }; } });
  }

  getSnapshot(): NetworkState { return this.current; }

  subscribe(listener: (state: NetworkState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.wx.offNetworkStatusChange?.(this.changed);
    this.listeners.clear();
  }
}
