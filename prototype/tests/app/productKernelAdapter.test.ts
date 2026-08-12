import { describe, expect, it } from "vitest";
import { createProductKernelAdapter } from "../../src/app/productKernelAdapter";

const players = [
  { id: "you", name: "你", avatar: "/you.png", isBot: false },
  { id: "bot", name: "Bot", avatar: "/bot.png", isBot: true },
];

function envelope(intent: Record<string, unknown>, sequence = 0) {
  return {
    type: "session.command" as const,
    protocolVersion: 1 as const,
    sessionId: "test",
    commandId: `command-${sequence}`,
    sequence,
    sentAt: 1_000,
    intent: intent as { type: string; [key: string]: unknown },
  };
}

describe("playable product kernel adapter", () => {
  it("runs login, room, Bot, match and a complete draw through one session seam", async () => {
    const kernel = createProductKernelAdapter({
      viewerId: "you",
      players,
      seed: 582913,
      sessionId: "test",
      room: { code: "582913", maxPlayers: 4, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, ruleset: "original-2025@1" },
    });
    let state = await kernel.create();
    for (const intent of [
      { type: "Login" },
      { type: "CreateRoom", settings: { maxPlayers: 4, allowBots: true } },
      { type: "AddBot" },
      { type: "StartMatch" },
    ]) {
      const result = await kernel.execute(state, envelope(intent));
      expect(result.ok).toBe(true);
      state = result.state;
    }
    const before = kernel.project(state) as any;
    expect(before).toMatchObject({ authenticated: true, status: "ACTIVE" });
    expect(before.players).toHaveLength(2);
    const drawn = await kernel.execute(state, envelope({ type: "Draw", turnId: before.turn?.id }, 1));
    expect(drawn.ok).toBe(true);
    const after = kernel.project(drawn.state) as any;
    expect(after.deckCount).toBe(before.deckCount - 2);
    expect(after.turn?.playerId).toBe("you");
  });

  it("never projects private card ids, deck order, or secret insertion positions into event history", async () => {
    const kernel = createProductKernelAdapter({
      viewerId: "you",
      players,
      seed: 17,
      sessionId: "privacy",
      room: { code: "000017", maxPlayers: 2, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, ruleset: "original-2025@1" },
    });
    let state = await kernel.create();
    for (const intent of [{ type: "Login" }, { type: "StartTutorial" }]) {
      const result = await kernel.execute(state, envelope(intent));
      state = result.state;
    }
    const serializedEvents = JSON.stringify((kernel.project(state) as any).events);
    expect(serializedEvents).not.toMatch(/cardId|cardIds|position|deck/i);
  });
});
