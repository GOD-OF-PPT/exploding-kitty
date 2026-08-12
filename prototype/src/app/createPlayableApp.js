import { BrowserSessionRepository } from "../adapters/persistence/BrowserSessionRepository";
import { createProductKernelAdapter } from "./productKernelAdapter";
import { createLocalSession } from "../session/createLocalSession";

const DEFAULT_PLAYERS = [
  { id: "you", name: "你", avatar: "/assets/cats/player.png", isBot: false },
  { id: "orange", name: "阿橘", avatar: "/assets/cats/a-ju.png", isBot: true },
  { id: "gray", name: "小灰", avatar: "/assets/cats/xiao-hui.png", isBot: true },
  { id: "white", name: "团子", avatar: "/assets/cats/tuan-zi.png", isBot: true },
];

export async function createPlayableSession(options = {}) {
  const repository = new BrowserSessionRepository(undefined, { prefix: "exploding-kitty:" });
  return createLocalSession({
    sessionId: options.sessionId || new URLSearchParams(window.location.search).get("session") || "local-room-v2",
    repository,
    kernel: createProductKernelAdapter({
      viewerId: "you",
      players: options.players || DEFAULT_PLAYERS,
      seed: options.seed || 582913,
      sessionId: options.sessionId || new URLSearchParams(window.location.search).get("session") || "local-room-v2",
      room: {
      code: options.code || "582913",
      maxPlayers: options.maxPlayers || 4,
      turnSeconds: options.turnSeconds || 45,
      responseSeconds: options.responseSeconds || 5,
      choiceSeconds: options.choiceSeconds || 15,
      allowBots: options.allowBots ?? true,
      ruleset: "original-2025@1",
      },
    }),
  });
}
