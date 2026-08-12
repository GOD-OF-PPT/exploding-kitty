import React from "react";
import { createRoot } from "react-dom/client";
import { createPlayableSession } from "./app/createPlayableApp.js";
import { resolveBootstrapRoute } from "./bootstrapRoute.js";
import { LiveGameApp } from "./live/LiveGameApp.jsx";
import "./styles.css";

const root = createRoot(document.getElementById("root"));

async function bootstrap() {
  const route = resolveBootstrapRoute(window.location.hash, import.meta.env.DEV);
  if (import.meta.env.DEV && route.surface === "audit") {
    const { renderAuditFixture } = await import("./live/auditFixture.jsx");
    root.render(renderAuditFixture(route.route));
    return;
  }
  if (import.meta.env.DEV && route.surface === "gallery") {
    const { App } = await import("./App.jsx");
    root.render(<App />);
    return;
  }
  try {
    const session = await createPlayableSession();
    root.render(<LiveGameApp session={session} />);
  } catch (error) {
    root.render(
      <main className="bootstrap-error">
        <h1>牌桌没有准备好</h1>
        <p>{error instanceof Error ? error.message : "请刷新后重试"}</p>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </main>,
    );
  }
}

bootstrap();
