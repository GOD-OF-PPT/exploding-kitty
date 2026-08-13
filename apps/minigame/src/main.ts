import * as sharedSession from "@exploding-kitty/session-client";
import { getWx, WxKeyboardAdapter, WxLifecycleAdapter, WxMediaAdapter, WxNetworkAdapter, WxShareAdapter } from "./platform";
import { createGameSession, readRuntimeConfig } from "./composition/runtime";
import { ScreenHost } from "./ui/screenHost";
import { applyCssPixelTransform, extractCssPoint, resolveCanvasMetrics, sizeDisplayCanvas } from "./ui/canvasMetrics";

let displayCanvas: HTMLCanvasElement | null = null;

async function bootstrap(): Promise<void> {
  const platform = getWx();
  displayCanvas ??= platform.createCanvas();
  const config = readRuntimeConfig(platform);
  const media = new WxMediaAdapter(platform);
  const keyboard = new WxKeyboardAdapter(platform);
  const share = new WxShareAdapter(platform);
  const session = await createGameSession(platform, config, sharedSession);
  const lifecycle = new WxLifecycleAdapter(platform);
  const network = new WxNetworkAdapter(platform);
  const host = new ScreenHost({ wx: platform, session, keyboard, media, share, initialJoinCode: config.joinCode, canvas: displayCanvas });

  lifecycle.subscribe(({ type, query }) => {
    if (type === "foreground") {
      host.handleLaunchQuery(query);
      session.reconnect?.();
    }
  });
  network.subscribe((state) => {
    if (state.connected) session.reconnect?.();
  });

  host.start();
  Object.assign(GameGlobal, {
    explodingKitty: {
      host,
      session,
      showScreen: (id: Parameters<ScreenHost["show"]>[0]) => host.show(id),
      dispose: () => { host.dispose(); lifecycle.dispose(); network.dispose(); media.dispose(); session.dispose(); },
    },
  });
}

function showBootstrapFailure(error: unknown): void {
  console.error("MINIGAME_BOOTSTRAP_FAILED", error);
  const platform = getWx();
  const info = platform.getSystemInfoSync();
  const metrics = resolveCanvasMetrics(info);
  displayCanvas ??= platform.createCanvas();
  const canvas = displayCanvas;
  sizeDisplayCanvas(canvas, metrics);
  const context = canvas.getContext("2d");
  if (!context) return;
  applyCssPixelTransform(context, metrics);
  context.fillStyle = "#171514";
  context.fillRect(0, 0, info.windowWidth, info.windowHeight);
  context.fillStyle = "#ffe11a";
  context.font = "bold 30px sans-serif";
  context.textAlign = "center";
  context.fillText("暂时没能进入牌桌", info.windowWidth / 2, info.windowHeight * 0.36);
  context.fillStyle = "#fff1c8";
  context.font = "15px sans-serif";
  const message = error instanceof Error ? error.message : "启动失败";
  context.fillText(message.slice(0, 42), info.windowWidth / 2, info.windowHeight * 0.43);
  context.fillStyle = "#00b8c4";
  context.fillRect(36, info.windowHeight * 0.54, info.windowWidth - 72, 56);
  context.fillStyle = "#171514";
  context.font = "bold 18px sans-serif";
  context.fillText("点击重试", info.windowWidth / 2, info.windowHeight * 0.54 + 36);
  const retry = (event: unknown) => {
    const point = extractCssPoint(event);
    if (!point || point.y < info.windowHeight * 0.52 || point.y > info.windowHeight * 0.64) return;
    platform.offTouchEnd(retry);
    void bootstrap().catch(showBootstrapFailure);
  };
  platform.onTouchEnd(retry);
}

void bootstrap().catch(showBootstrapFailure);
