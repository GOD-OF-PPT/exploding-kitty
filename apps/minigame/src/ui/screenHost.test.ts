import { describe, expect, it, vi } from "vitest";
import type { GameSession, RawProductView, ScreenAction, ScreenId } from "./model";
import type { WxKeyboardAdapter, WxLike, WxMediaAdapter, WxShareAdapter } from "../platform";

// Mock the layout engine — the real module imports minigame-canvas-engine
// which accesses `window` at load time and cannot run in a Node test env.
vi.mock("./layoutEngine", () => ({
  default: {
    clear: vi.fn(),
    clearAll: vi.fn(),
    init: vi.fn(),
    layout: vi.fn(),
    updateViewPort: vi.fn(),
    getElementById: vi.fn(() => null),
  },
}));

import { ScreenHost } from "./screenHost";
import { normalizeProductView, type ProductViewModel } from "./normalize";

const loginAction: ScreenAction = {
  id: "login",
  label: "进入游戏",
  intent: { type: "Login", provider: "wechat" },
};

function createMockCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ({}),
  } as unknown as HTMLCanvasElement;
}

function createMockWx(): WxLike {
  return {
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, platform: "ios" }),
  } as unknown as WxLike;
}

function createMockMedia(): WxMediaAdapter {
  return {
    getSnapshot: () => ({ sound: true, vibration: true }),
    update: vi.fn(() => ({ sound: true, vibration: true })),
    play: vi.fn(),
    impact: vi.fn(),
    dispose: vi.fn(),
  } as unknown as WxMediaAdapter;
}

function createMockKeyboard(): WxKeyboardAdapter {
  return { open: vi.fn(), close: vi.fn() } as unknown as WxKeyboardAdapter;
}

function createMockShare(): WxShareAdapter {
  return { room: vi.fn(), copy: vi.fn() } as unknown as WxShareAdapter;
}

interface MockSession {
  getSnapshot(): { lifecycle: string; connectivity: string; view: RawProductView; revision: number };
  subscribe(listener: () => void): () => void;
  send: ReturnType<typeof vi.fn>;
  reconnect: ReturnType<typeof vi.fn>;
  dispose(): void;
}

function createMockSession(connectivity: string, authenticated: boolean): MockSession {
  const view = { authenticated, phase: "HOME", viewerId: "you" } as RawProductView;
  return {
    getSnapshot: () => ({ lifecycle: "active", connectivity, view, revision: 0 }),
    subscribe: () => () => {},
    send: vi.fn(async () => ({ ok: true, revision: 0 })),
    reconnect: vi.fn(),
    dispose: () => {},
  };
}

function createView(authenticated: boolean, connectivity: string): ProductViewModel {
  return normalizeProductView(
    { authenticated, phase: "HOME", viewerId: "you" } as RawProductView,
    connectivity,
  );
}

function createScreenHost(session: MockSession): ScreenHost {
  const host = new ScreenHost({
    wx: createMockWx(),
    session: session as unknown as GameSession<RawProductView>,
    keyboard: createMockKeyboard(),
    media: createMockMedia(),
    share: createMockShare(),
    canvas: createMockCanvas(),
  });
  // Stub render() — it requires a full canvas/layout environment not available in unit tests.
  (host as unknown as { render: () => void }).render = () => {};
  return host;
}

async function performLogin(host: ScreenHost, view: ProductViewModel): Promise<void> {
  return (host as unknown as { perform(action: ScreenAction, view: ProductViewModel): Promise<void> }).perform(loginAction, view);
}

function resolveScreenId(host: ScreenHost, view: ProductViewModel): ScreenId {
  return (host as unknown as { resolveId(view: ProductViewModel): ScreenId }).resolveId(view);
}

describe("ScreenHost Login UX", () => {
  describe("VAL-M2-006: Login intent intercepted locally in RemoteGameSession", () => {
    it("does not call session.send() for Login on a remote session", async () => {
      const session = createMockSession("online", false);
      const host = createScreenHost(session);
      const view = createView(false, "online");

      await performLogin(host, view);

      expect(session.send).not.toHaveBeenCalled();
    });

    it("does not surface an error for Login on a remote session", async () => {
      const session = createMockSession("online", false);
      const host = createScreenHost(session);
      const view = createView(false, "online");

      await performLogin(host, view);

      expect((host as unknown as { error: string | null }).error).toBeNull();
    });

    it("still calls session.send() for Login on a demo session (unchanged behavior)", async () => {
      const session = createMockSession("local", false);
      const host = createScreenHost(session);
      const view = createView(false, "local");

      await performLogin(host, view);

      expect(session.send).toHaveBeenCalledOnce();
      expect(session.send).toHaveBeenCalledWith(expect.objectContaining({ type: "Login" }));
    });
  });

  describe("VAL-M2-007: Login scene not reachable in authenticated remote state", () => {
    it("resolveId returns home when override is login and user is authenticated", () => {
      const session = createMockSession("online", true);
      const host = createScreenHost(session);
      (host as unknown as { override: string | null }).override = "login";
      const view = createView(true, "online");

      expect(resolveScreenId(host, view)).toBe("home");
    });

    it("resolveId returns login when override is login and user is unauthenticated", () => {
      const session = createMockSession("online", false);
      const host = createScreenHost(session);
      (host as unknown as { override: string | null }).override = "login";
      const view = createView(false, "online");

      expect(resolveScreenId(host, view)).toBe("login");
    });

    it("show('login') redirects to home when authenticated", () => {
      const session = createMockSession("online", true);
      const host = createScreenHost(session);

      host.show("login");

      expect((host as unknown as { override: string | null }).override).toBe("home");
    });
  });
});
