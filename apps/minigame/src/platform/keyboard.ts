import type { WxLike } from "./wx";

export type KeyboardRequest = Readonly<{ value?: string; maxLength: number; numeric?: boolean }>;

export class WxKeyboardAdapter {
  private closeActive: (() => void) | null = null;

  constructor(private readonly wx: WxLike) {}

  open(request: KeyboardRequest, onInput?: (value: string) => void): Promise<string> {
    this.closeActive?.();
    return new Promise((resolve, reject) => {
      let settled = false;
      const normalize = (value: string) => request.numeric ? value.replace(/\D/g, "").slice(0, request.maxLength) : value.slice(0, request.maxLength);
      const input = ({ value }: { value: string }) => onInput?.(normalize(value));
      const finish = ({ value }: { value: string }) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(normalize(value));
      };
      const cleanup = () => {
        this.wx.offKeyboardInput?.(input);
        this.wx.offKeyboardConfirm?.(finish);
        this.wx.offKeyboardComplete?.(finish);
        if (this.closeActive === cancel) this.closeActive = null;
      };
      const cancel = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("KEYBOARD_CANCELLED"));
      };
      this.closeActive = cancel;
      this.wx.onKeyboardInput(input);
      this.wx.onKeyboardConfirm(finish);
      this.wx.onKeyboardComplete(finish);
      this.wx.showKeyboard({
        defaultValue: request.value ?? "",
        maxLength: request.maxLength,
        multiple: false,
        confirmHold: false,
        confirmType: "done",
        fail: (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(String(error.errMsg ?? "KEYBOARD_OPEN_FAILED")));
        },
      });
    });
  }

  close(): void {
    this.closeActive?.();
    this.wx.hideKeyboard();
  }
}
