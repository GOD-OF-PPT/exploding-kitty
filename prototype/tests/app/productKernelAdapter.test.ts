import { describe, expect, it } from "vitest";
import { createProductKernelAdapter } from "../../src/app/productKernelAdapter";

const players = [
  { id: "you", name: "你", avatar: "/you.png", isBot: false },
  { id: "bot", name: "Bot", avatar: "/bot.png", isBot: true },
];

const memberRoomPlayers = [
  players[0],
  { id: "host", name: "房主", avatar: "/host.png", isBot: false },
];

function envelope(intent: Record<string, unknown>, sequence = 0, sentAt = 1_000) {
  return {
    type: "session.command" as const,
    protocolVersion: 1 as const,
    sessionId: "test",
    commandId: `command-${sequence}`,
    sequence,
    sentAt,
    intent: intent as { type: string; [key: string]: unknown },
  };
}

describe("playable product kernel adapter", () => {
  it("keeps a ready member in the lobby until the host starts", async () => {
    const options = {
      viewerId: "you",
      players,
      seed: 582913,
      sessionId: "room-membership",
      room: { code: "582913", maxPlayers: 4, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, ruleset: "original-2025@1" },
    };

    const creatorKernel = createProductKernelAdapter(options);
    const created = await creatorKernel.execute(
      await creatorKernel.create(),
      envelope({ type: "CreateRoom", settings: { maxPlayers: 4 } }),
    );
    expect(created.ok).toBe(true);
    const creatorView = creatorKernel.project(created.state) as any;
    expect(creatorView.room.ownerId).toBe("you");
    expect(creatorView.room.players.find((player: any) => player.id === "you")?.host).toBe(true);

    const joinerKernel = createProductKernelAdapter({ ...options, players: memberRoomPlayers });
    const joined = await joinerKernel.execute(
      await joinerKernel.create(),
      envelope({ type: "JoinRoom", code: "654321" }),
    );
    expect(joined.ok).toBe(true);
    const memberView = joinerKernel.project(joined.state) as any;
    expect(memberView.room.ownerId).not.toBe("you");
    expect(memberView.room.ownerId).toBe("host");
    expect(memberView.room.players.find((player: any) => player.id === "you")?.host).toBe(false);
    expect(memberView.room.players.find((player: any) => player.id === memberView.room.ownerId)?.host).toBe(true);
    expect(memberView.room.players.find((player: any) => player.id === "you")?.ready).toBe(false);

    const memberReady = await joinerKernel.execute(
      joined.state,
      envelope({ type: "SetReady", ready: true }, 1),
    );
    expect(memberReady.ok).toBe(true);
    expect(joinerKernel.project(memberReady.state)).toMatchObject({ phase: "LOBBY" });
    expect(joinerKernel.project(memberReady.state)).not.toHaveProperty("matchId");

    const memberStart = await joinerKernel.execute(
      memberReady.state,
      envelope({ type: "StartMatch" }, 2),
    );
    expect(memberStart).toMatchObject({ ok: false, problem: { code: "NOT_ROOM_HOST" } });
    expect(joinerKernel.project(memberStart.state)).toMatchObject({ phase: "LOBBY" });
    expect(joinerKernel.project(memberStart.state)).not.toHaveProperty("matchId");
  });

  it("starts only after the host command and gives the host the first turn", async () => {
    const kernel = createProductKernelAdapter({
      viewerId: "you",
      players,
      seed: 582913,
      sessionId: "host-start",
      room: { code: "582913", maxPlayers: 4, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, ruleset: "original-2025@1" },
    });
    let state = await kernel.create();
    for (const intent of [
      { type: "CreateRoom", settings: { maxPlayers: 4, allowBots: true } },
      { type: "AddBot" },
    ]) {
      const result = await kernel.execute(state, envelope(intent));
      expect(result.ok).toBe(true);
      state = result.state;
    }

    expect(kernel.project(state)).toMatchObject({ phase: "LOBBY" });
    expect(kernel.project(state)).not.toHaveProperty("matchId");

    const started = await kernel.execute(state, envelope({ type: "StartMatch" }, 1));
    expect(started.ok).toBe(true);
    const match = kernel.project(started.state) as any;
    expect(match).toMatchObject({ phase: "MATCH", status: "ACTIVE" });
    expect(match.turn?.playerId).toBe(match.room.ownerId);
  });

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

  it("does not let an old timer settle the current response window", async () => {
    const kernel = createProductKernelAdapter({
      viewerId: "you",
      players,
      seed: 582913,
      sessionId: "deadline-race",
      room: { code: "582913", maxPlayers: 2, turnSeconds: 45, responseSeconds: 5, choiceSeconds: 15, allowBots: true, ruleset: "original-2025@1" },
    });
    let state = await kernel.create();
    const tutorial = await kernel.execute(state, envelope({ type: "StartTutorial" }));
    expect(tutorial.ok).toBe(true);
    state = tutorial.state;

    const initial = kernel.project(state) as any;
    const skip = initial.you.hand.find((card: any) => card.type === "SKIP");
    const nope = initial.you.hand.find((card: any) => card.type === "NOPE");
    expect({ skip: Boolean(skip), nope: Boolean(nope) }).toEqual({ skip: true, nope: true });
    const turnId = initial.turn.id;

    const played = await kernel.execute(state, envelope({ type: "PlayCards", cardTokens: [skip.id] }, 1, 1_100));
    expect(played.ok).toBe(true);
    state = played.state;
    const firstWindow = (state as any).game.pending;
    expect(firstWindow).toMatchObject({ kind: "RESPONSE" });

    const noped = await kernel.execute(state, envelope({ type: "PlayNope", windowId: firstWindow.windowId }, 2, 1_200));
    expect(noped.ok).toBe(true);
    state = noped.state;
    const current = kernel.project(state) as any;
    expect(current.pending).toMatchObject({ kind: "RESPONSE", nopeCount: 1 });
    expect(current.pending.deadlineId).not.toBe(firstWindow.deadlineId);

    const stale = await kernel.execute(
      state,
      envelope({ type: "DeadlineElapsed", deadlineId: firstWindow.deadlineId }, 3, current.pending.deadline),
    );
    expect(stale).toMatchObject({ ok: false, problem: { code: "STALE_DEADLINE" } });
    expect(kernel.project(stale.state)).toMatchObject({
      pending: {
        kind: "RESPONSE",
        deadlineId: current.pending.deadlineId,
        nopeCount: 1,
      },
      turn: { id: turnId },
    });

    const early = await kernel.execute(
      state,
      envelope({ type: "DeadlineElapsed", deadlineId: current.pending.deadlineId }, 4, current.pending.deadline - 1),
    );
    expect(early).toMatchObject({ ok: false, problem: { code: "DEADLINE_NOT_ELAPSED" } });
    expect(kernel.project(early.state)).toMatchObject({
      pending: { deadlineId: current.pending.deadlineId, nopeCount: 1 },
      turn: { id: turnId },
    });
  });
});
