import { describe, expect, it } from "vitest";
import { normalizeProductView } from "../ui/normalize";
import { DemoGameSession } from "./demoSession";

describe("DemoGameSession", () => {
  it("starts an actionable two-player tutorial and returns the turn after the Bot", async () => {
    const session = new DemoGameSession();
    await session.send({ type: "Login" });
    await session.send({ type: "StartTutorial" });

    let view = normalizeProductView(session.getSnapshot().view, "local");
    expect(view.room.tutorial).toBe(true);
    expect(view.players).toHaveLength(2);
    expect(view.players.filter((player) => player.bot)).toHaveLength(1);
    expect(view.legalActions).toContain("Draw");
    expect(view.legalActions).toContain("PlayCards");

    const firstMatchId = view.game.id;
    await session.send({ type: "Draw", turnId: view.game.turnId });
    view = normalizeProductView(session.getSnapshot().view, "local");
    expect(view.game.turnPlayerId).toBe("you");
    expect(view.events.at(-1)?.type).toContain("Bot");
    expect(view.legalActions).toContain("Draw");

    await session.send({ type: "RestartMatch" });
    view = normalizeProductView(session.getSnapshot().view, "local");
    expect(view.game.id).not.toBe(firstMatchId);
  });
});
