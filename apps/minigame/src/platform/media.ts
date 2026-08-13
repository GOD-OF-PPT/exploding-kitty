import type { WxAudioContext, WxLike } from "./wx";

export type MediaSettings = Readonly<{ sound: boolean; vibration: boolean }>;

export class WxMediaAdapter {
  private settings: MediaSettings;
  private readonly sounds = new Map<string, WxAudioContext>();

  constructor(private readonly wx: WxLike, initial?: MediaSettings) {
    const stored = wx.getStorageSync("ek.media.v1");
    this.settings = initial ?? (isMediaSettings(stored) ? stored : { sound: true, vibration: true });
  }

  update(settings: Partial<MediaSettings>): MediaSettings {
    this.settings = { ...this.settings, ...settings };
    this.wx.setStorageSync("ek.media.v1", this.settings);
    if (!this.settings.sound) for (const audio of this.sounds.values()) audio.stop();
    return this.settings;
  }

  getSnapshot(): MediaSettings { return this.settings; }

  play(id: string, source: string, volume = 0.8): void {
    if (!this.settings.sound) return;
    let audio = this.sounds.get(id);
    if (!audio) {
      audio = this.wx.createInnerAudioContext();
      audio.loop = false;
      this.sounds.set(id, audio);
    }
    audio.src = source;
    audio.volume = volume;
    audio.play();
  }

  impact(type: "light" | "medium" | "heavy" = "medium"): void {
    if (this.settings.vibration) this.wx.vibrateShort({ type, fail: () => undefined });
  }

  dispose(): void {
    for (const audio of this.sounds.values()) audio.destroy();
    this.sounds.clear();
  }
}

function isMediaSettings(value: unknown): value is MediaSettings {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.sound === "boolean" && typeof record.vibration === "boolean";
}

export class WxShareAdapter {
  constructor(private readonly wx: WxLike) {}

  room(code: string): void {
    this.wx.shareAppMessage({ title: `Join room ${code}`, imageUrl: "assets/cat-cast.png", query: `room=${encodeURIComponent(code)}` });
  }

  copy(text: string): Promise<void> {
    if (!this.wx.setClipboardData) return Promise.resolve();
    return new Promise((resolve, reject) => this.wx.setClipboardData?.({ data: text, success: resolve, fail: () => reject(new Error("CLIPBOARD_WRITE_FAILED")) }));
  }
}
