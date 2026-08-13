import { describe, expect, it } from "vitest";
import { ALL_SCREEN_IDS, buildScreen, deriveScreen } from "./sceneRegistry";
import { normalizeProductView } from "./normalize";

describe("scene registry", () => {
  it("registers and builds all 25 product states", () => {
    expect(ALL_SCREEN_IDS).toHaveLength(25);
    const view = normalizeProductView({ phase: "MATCH", authenticated: true, viewerId: "you", matchId: "m1", turn: { id: "t1", playerId: "you" } });
    for (const id of ALL_SCREEN_IDS) expect(buildScreen(id, { view, settings: { sound: true, vibration: true } }).id).toBe(id);
  });

  it("shows network recovery instead of a login command before a server snapshot exists", () => {
    const view = normalizeProductView(null, "connecting");
    expect(deriveScreen({ view })).toBe("network");
  });

  it("shows a stable network state after an online snapshot", () => {
    const view = normalizeProductView({ phase: "HOME", viewerId: "you" }, "online");
    const screen = buildScreen("network", { view });
    expect(screen.title).toBe("连接稳定");
    expect(screen.actions?.[0]).toMatchObject({ back: true });
  });

  it("keeps authoritative empty hands and player lists empty", () => {
    const view = normalizeProductView({ phase: "HOME", viewerId: "you", players: [], you: { id: "you", hand: [] } }, "online");
    expect(view.hand).toEqual([]);
    expect(view.players).toEqual([]);
  });

  it("uses the last discard and preserves private peek cards", () => {
    const view = normalizeProductView({
      phase: "MATCH", viewerId: "you", discard: [{ type: "ATTACK" }, { type: "SKIP" }],
      privatePeek: [{ type: "CAT_TACO" }], pending: { kind: "PRIVATE_PEEK", cards: [{ type: "CAT_BEARD" }] },
    }, "online");
    expect(view.game.discard?.type).toBe("SKIP");
    expect(view.privatePeek[0]?.type).toBe("CAT_TACO");
    expect(view.pending?.kind === "PRIVATE_PEEK" ? view.pending.cards[0]?.type : undefined).toBe("CAT_BEARD");
  });

  it("lets members vote while only the host restarts", () => {
    const host = normalizeProductView({ phase: "FINISHED", viewerId: "host", winnerId: "host", room: { ownerId: "host" } }, "online");
    const member = normalizeProductView({ phase: "FINISHED", viewerId: "member", winnerId: "host", room: { ownerId: "host" } }, "online");
    expect(buildScreen("result", { view: host }).actions?.[0]?.intent?.type).toBe("RestartMatch");
    expect(buildScreen("result", { view: member }).actions?.[0]?.intent?.type).toBe("VoteRestart");
  });

  it("routes authoritative pending states and attack debt into reachable scenes", () => {
    const base = { phase: "MATCH", viewerId: "you", matchId: "m1", you: { id: "you", alive: true, hand: [] }, turn: { id: "t1", playerId: "you", remaining: 1 } };
    const cases = [
      [{ ...base, pending: { kind: "RESPONSE", id: "w1" } }, "response"],
      [{ ...base, pending: { kind: "GIVE_CARD", id: "p1" } }, "give-card"],
      [{ ...base, pending: { kind: "PRIVATE_PEEK", id: "p1" } }, "future"],
      [{ ...base, pending: { kind: "EXPLOSION", id: "p1" } }, "explosion"],
      [{ ...base, pending: { kind: "DEFUSE_INSERTION", id: "p1" } }, "defuse"],
      [{ ...base, turn: { id: "t1", playerId: "you", remaining: 2 } }, "attack"],
    ] as const;
    for (const [raw, expected] of cases) expect(deriveScreen({ view: normalizeProductView(raw, "online") })).toBe(expected);
  });

  it("builds private choice screens from real snapshot data", () => {
    const view = normalizeProductView({
      phase: "MATCH", viewerId: "you", matchId: "m1", deckCount: 3,
      you: { id: "you", alive: true, hand: [{ token: "a", type: "ATTACK" }, { token: "b", type: "SKIP" }] },
      pending: { kind: "GIVE_CARD", id: "p1", promptId: "p1" },
      privatePeek: [{ type: "CAT_TACO" }], legalActions: [{ type: "ChooseCard", promptId: "p1", cardTokens: ["a", "b"] }],
    }, "online");
    expect(buildScreen("give-card", { view }).cards).toHaveLength(2);
    const future = buildScreen("future", { view: { ...view, pending: { kind: "PRIVATE_PEEK", id: "peek", promptId: "peek", cards: [], deadline: 0 } } });
    expect(future.cards?.map((card) => card.type)).toEqual(["CAT_TACO"]);
  });

  it("only exposes authoritative response and private-choice commands", () => {
    const response = normalizeProductView({
      phase: "MATCH", viewerId: "you", matchId: "m1", pending: { kind: "RESPONSE", id: "w1", windowId: "w1" },
      you: { id: "you", hand: [{ token: "nope", type: "NOPE" }] },
      legalActions: [{ type: "PassResponse", windowId: "w1" }],
    }, "online");
    expect(buildScreen("response", { view: response }).actions?.map((action) => action.intent?.type)).toEqual(["PassResponse"]);

    const peek = normalizeProductView({
      phase: "MATCH", viewerId: "you", matchId: "m1", pending: { kind: "PRIVATE_PEEK", id: "p1", promptId: "p1", cards: [{ type: "SKIP" }] },
      legalActions: [{ type: "AcknowledgePeek", promptId: "p1" }],
    }, "online");
    expect(buildScreen("future", { view: peek }).actions?.[0]?.intent?.type).toBe("AcknowledgePeek");

    const insert = normalizeProductView({
      phase: "MATCH", viewerId: "you", matchId: "m1", pending: { kind: "DEFUSE_INSERTION", id: "p2", promptId: "p2", deckSize: 4 },
      legalActions: [{ type: "InsertKitten", promptId: "p2" }],
    }, "online");
    expect(buildScreen("defuse", { view: insert, insertionPosition: 4 }).actions?.[0]?.intent).toMatchObject({ type: "InsertKitten", position: 4 });
  });

  it("renders authoritative countdowns and the public action behind a Nope window", () => {
    const view = normalizeProductView({
      phase: "MATCH", viewerId: "you", serverTime: 10_000, matchId: "m1",
      players: [{ id: "you", name: "你" }, { id: "actor", name: "阿橘" }, { id: "target", name: "团子" }],
      turn: { id: "t1", playerId: "you", number: 2, remaining: 1, deadlineAt: 19_500 },
      pending: { kind: "RESPONSE", id: "w1", windowId: "w1", deadlineAt: 14_500, actorId: "actor", targetId: "target", cardTypes: ["FAVOR"], declaredCardType: "DEFUSE" },
      legalActions: [{ type: "PassResponse", windowId: "w1" }],
    }, "online");
    const response = buildScreen("response", { view, now: 12_000 });
    expect(response.eyebrow).toContain("3 秒");
    expect(response.subtitle).toContain("阿橘");
    expect(response.subtitle).toContain("帮忙");
    expect(response.subtitle).toContain("团子");
    expect(response.subtitle).toContain("拆弹");
    expect(buildScreen("game", { view: { ...view, pending: null }, now: 12_000 }).eyebrow).toContain("8 秒");
  });

  it("states that neither Defuse nor an exploding kitten can be Noped", () => {
    const view = normalizeProductView({ phase: "HOME", viewerId: "you" }, "online");
    expect(buildScreen("card-detail", { view, selectedCard: 2 }).rows?.find((row) => row.id === "nope")?.badge).toBe("否");
    expect(buildScreen("card-detail", { view, selectedCard: 1 }).rows?.find((row) => row.id === "nope")?.badge).toBe("否");
  });

  it("summarizes a public draw in Chinese without revealing the drawn card", () => {
    const view = normalizeProductView({
      phase: "MATCH", viewerId: "you",
      events: [{ sequence: 3, type: "CARD_DRAWN", actorId: "other", cardType: "DEFUSE" }],
    }, "online");
    const row = buildScreen("history", { view }).rows?.[0];

    expect(row?.title).toBe("一名玩家抽了一张牌");
    expect(row?.title).not.toContain("拆弹");
    expect(row?.title).not.toContain("DEFUSE");
  });

  it("marks cancel and completion navigation as true back actions", () => {
    const view = normalizeProductView({ phase: "HOME", viewerId: "you" }, "online");
    expect(buildScreen("play-mode", { view }).actions?.[0]).toMatchObject({ id: "back", back: true });
    expect(buildScreen("settings", { view, settings: { sound: true, vibration: true } }).actions?.[0]).toMatchObject({ id: "back", back: true });
  });

  it("describes sound settings without promising background music", () => {
    const view = normalizeProductView({ phase: "HOME", viewerId: "you" }, "online");
    const sound = buildScreen("settings", { view, settings: { sound: true, vibration: true } }).rows?.find((row) => row.id === "sound");
    expect(sound?.detail).toBe("卡牌与危险提示音");
  });

  it("keeps every home action reachable within the four-button dock", () => {
    const view = normalizeProductView({ phase: "HOME", viewerId: "you" }, "online");
    const screen = buildScreen("home", { view });
    expect(screen.actions).toHaveLength(4);
    expect(screen.rows?.some((row) => row.id === "settings" && row.action?.next === "settings")).toBe(true);
  });

  it("walks through the three tutorial cards before starting a tutorial match", () => {
    const view = normalizeProductView({ phase: "HOME", viewerId: "you" }, "online");
    const first = buildScreen("tutorial", { view, tutorialStep: 0 });
    const second = buildScreen("tutorial", { view, tutorialStep: 1 });
    const third = buildScreen("tutorial", { view, tutorialStep: 2 });

    expect([first.eyebrow, second.eyebrow, third.eyebrow]).toEqual(["1 / 3", "2 / 3", "3 / 3"]);
    expect([first.rows?.[0]?.title, second.rows?.[0]?.title, third.rows?.[0]?.title]).toEqual([
      "先出牌，再抽牌",
      "别抽到危险猫",
      "最后一只猫获胜",
    ]);
    expect(first.actions?.[0]?.intent?.type).toBe("NextTutorialStep");
    expect(second.actions?.[0]?.intent?.type).toBe("NextTutorialStep");
    expect(third.actions?.[0]?.intent?.type).toBe("StartTutorial");
  });

  it("derives reconnect-safe tutorial guidance from authoritative event sequences", () => {
    const view = normalizeProductView({
      phase: "MATCH", viewerId: "you", matchId: "tutorial-match",
      room: { tutorial: true }, turn: { id: "turn-1", playerId: "you" },
      events: [
        { sequence: 1, type: "MATCH_STARTED" },
        { sequence: 2, type: "TURN_STARTED" },
        { sequence: 3, type: "CARDS_COMMITTED" },
        { sequence: 4, type: "ACTION_RESOLVED" },
        { sequence: 7, type: "TURN_STARTED" },
        { sequence: 8, type: "CARD_DRAWN" },
      ],
    }, "online");

    expect(buildScreen("game", { view: { ...view, events: view.events.slice(0, 2) } }).rows?.[0]?.title).toContain("第 1 步");
    expect(buildScreen("game", { view: { ...view, events: view.events.slice(0, 4) } }).rows?.[0]?.title).toContain("第 2 步");
    expect(buildScreen("game", { view }).rows?.[0]?.title).toContain("第 3 步");
  });

  it("requires an eligible selected target and triple declaration before confirmation", () => {
    const view = normalizeProductView({
      phase: "MATCH", viewerId: "you", matchId: "m1", turn: { id: "t1", playerId: "you" },
      you: { id: "you", hand: [{ token: "a", type: "CAT_TACO" }, { token: "b", type: "CAT_TACO" }, { token: "c", type: "CAT_TACO" }] },
      players: [{ id: "you", alive: true, handCount: 3 }, { id: "target", alive: true, handCount: 2 }],
      legalActions: [{ type: "PlayCards", turnId: "t1", cardTokens: ["a", "b", "c"] }],
    }, "online");
    expect(buildScreen("favor", { view, selectedTokens: ["a", "b", "c"] }).actions?.map((action) => action.id)).toEqual(["back"]);
    expect(buildScreen("favor", { view, selectedTokens: ["a", "b", "c"], selectedTargetId: "target", declaredCardType: "FAVOR" }).actions?.map((action) => action.id)).toEqual(["confirm", "back"]);
  });

  it("does not permit a non-authoritative card in the favor response", () => {
    const view = normalizeProductView({
      phase: "MATCH", viewerId: "you", matchId: "m1", pending: { kind: "GIVE_CARD", promptId: "p1" },
      you: { id: "you", hand: [{ token: "allowed", type: "ATTACK" }, { token: "blocked", type: "SKIP" }] },
      legalActions: [{ type: "ChooseCard", promptId: "p1", cardTokens: ["allowed"] }],
    }, "online");
    expect(buildScreen("give-card", { view, selectedTokens: ["blocked"] }).actions).toEqual([]);
    expect(buildScreen("give-card", { view, selectedTokens: ["allowed"] }).actions?.[0]?.intent).toMatchObject({ type: "ChooseCard", cardToken: "allowed" });
  });
});
