import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { createPlayableSession } from "./app/createPlayableApp.js";
import { LiveGameApp } from "./live/LiveGameApp.jsx";
import "./styles.css";

const root = createRoot(document.getElementById("root"));

async function bootstrap() {
  if (window.location.hash === "#gallery" || window.location.hash.startsWith("#gallery/")) {
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
