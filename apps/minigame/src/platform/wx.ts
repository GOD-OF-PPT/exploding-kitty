export type WxResult = Record<string, unknown>;

export interface WxSocketTask {
  send(options: { data: string | ArrayBuffer; success?: () => void; fail?: (error: WxResult) => void }): void;
  close(options?: { code?: number; reason?: string }): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (event: { data: string | ArrayBuffer }) => void): void;
  onClose(listener: (event: { code?: number; reason?: string }) => void): void;
  onError(listener: (error: WxResult) => void): void;
}

export interface WxAudioContext {
  src: string;
  volume: number;
  loop: boolean;
  play(): void;
  stop(): void;
  destroy(): void;
}

export type WxCloudContainerResult = Readonly<{
  statusCode: number;
  data: unknown;
  errMsg?: string;
  callID?: string;
}>;

export interface WxCloudLike {
  init(options?: { env?: string; traceUser?: boolean }): void | Promise<void>;
  callContainer(options: {
    config: { env: string };
    path: string;
    method?: string;
    data?: unknown;
    header?: Record<string, string>;
    timeout?: number;
  }): Promise<WxCloudContainerResult>;
}

export interface WxLike {
  cloud?: WxCloudLike;
  getSystemInfoSync(): {
    windowWidth: number;
    windowHeight: number;
    pixelRatio: number;
    safeArea?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
    platform?: string;
  };
  getLaunchOptionsSync?(): { query?: Record<string, string>; scene?: number };
  createCanvas(): HTMLCanvasElement;
  createImage?(): HTMLImageElement;
  login(options: { timeout?: number; success: (result: { code: string }) => void; fail: (error: WxResult) => void }): void;
  request(options: {
    url: string;
    method?: string;
    data?: unknown;
    header?: Record<string, string>;
    timeout?: number;
    success: (result: { statusCode: number; data: unknown }) => void;
    fail: (error: WxResult) => void;
  }): void;
  connectSocket(options: { url: string; header?: Record<string, string>; protocols?: string[]; timeout?: number }): WxSocketTask;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
  onShow(listener: (options?: WxResult) => void): void;
  offShow?(listener: (options?: WxResult) => void): void;
  onHide(listener: () => void): void;
  offHide?(listener: () => void): void;
  onNetworkStatusChange(listener: (event: { isConnected: boolean; networkType: string }) => void): void;
  offNetworkStatusChange?(listener: (event: { isConnected: boolean; networkType: string }) => void): void;
  getNetworkType(options: { success: (event: { networkType: string }) => void; fail?: (error: WxResult) => void }): void;
  showKeyboard(options: {
    defaultValue?: string;
    maxLength?: number;
    multiple?: boolean;
    confirmHold?: boolean;
    confirmType?: "done" | "next" | "search" | "go" | "send";
    success?: () => void;
    fail?: (error: WxResult) => void;
  }): void;
  hideKeyboard(options?: { complete?: () => void }): void;
  onKeyboardInput(listener: (event: { value: string }) => void): void;
  offKeyboardInput?(listener: (event: { value: string }) => void): void;
  onKeyboardConfirm(listener: (event: { value: string }) => void): void;
  offKeyboardConfirm?(listener: (event: { value: string }) => void): void;
  onKeyboardComplete(listener: (event: { value: string }) => void): void;
  offKeyboardComplete?(listener: (event: { value: string }) => void): void;
  createInnerAudioContext(): WxAudioContext;
  vibrateShort(options?: { type?: "heavy" | "medium" | "light"; fail?: () => void }): void;
  shareAppMessage(options: { title: string; imageUrl?: string; query?: string }): void;
  setClipboardData?(options: { data: string; success?: () => void; fail?: () => void }): void;
  onTouchStart(listener: (event: unknown) => void): void;
  onTouchMove(listener: (event: unknown) => void): void;
  onTouchEnd(listener: (event: unknown) => void): void;
  onTouchCancel(listener: (event: unknown) => void): void;
  offTouchStart(listener: (event: unknown) => void): void;
  offTouchMove(listener: (event: unknown) => void): void;
  offTouchEnd(listener: (event: unknown) => void): void;
  offTouchCancel(listener: (event: unknown) => void): void;
}

declare global {
  const wx: WxLike;
  const GameGlobal: Record<string, unknown>;
}

export function getWx(): WxLike {
  if (typeof wx === "undefined") throw new Error("WX_RUNTIME_UNAVAILABLE");
  return wx;
}

export function wxError(error: WxResult, fallback: string): Error {
  const message = typeof error.errMsg === "string" ? error.errMsg : fallback;
  return new Error(message);
}
