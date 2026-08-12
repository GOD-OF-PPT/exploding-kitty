import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  completeTutorial,
  LiveGameApp,
  TutorialView,
  transitionOverlay,
} from "../../src/live/LiveGameApp.jsx";

function homeSession() {
  const snapshot = {
    authenticated: true,
    lifecycle: "ACTIVE",
    connectivity: "local",
    viewerId: "me",
    user: { id: "me", name: "蓝耳队长", avatar: "/assets/cats/player.png" },
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    send: async () => ({ ok: true, snapshot }),
  };
}

function matchSession() {
  const snapshot = {
    authenticated: true,
    lifecycle: "ACTIVE",
    connectivity: "local",
    viewerId: "me",
    user: { id: "me", name: "蓝耳队长", avatar: "/assets/cats/player.png" },
    room: { id: "room", code: "582913", ownerId: "me", maxPlayers: 4 },
    game: { id: "match", turnId: "turn-1", turnPlayerId: "me", turnNumber: 1, drawPileCount: 12 },
    players: [
      { id: "me", name: "蓝耳队长", alive: true, connected: true, handCount: 0 },
      { id: "other", name: "阿橘", alive: true, connected: true, handCount: 4 },
    ],
    hand: [],
    legalActions: ["Draw", "PlayCards"],
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    send: async () => ({ ok: true, snapshot }),
  };
}

describe("live match navigation", () => {
  it("keeps menu, history, and rules reachable from the table toolbar", () => {
    const markup = renderToStaticMarkup(<LiveGameApp session={matchSession()} />);
    expect(markup).toContain('aria-label="对局菜单"');
    expect(markup).toContain('aria-label="行动记录"');
    expect(markup).toContain('aria-label="规则图鉴"');
  });

  it("exposes match settings, network status, rules, and concede from the menu", () => {
    const markup = renderToStaticMarkup(<LiveGameApp session={matchSession()} initialOverlay="menu" />);
    expect(markup).toContain("查看规则");
    expect(markup).toContain("声音与振动");
    expect(markup).toContain("网络状态");
    expect(markup).toContain("认输并离开");
  });

  it("renders the tutorial as a review while a match is active", () => {
    const markup = renderToStaticMarkup(<LiveGameApp session={matchSession()} initialOverlay="tutorial" />);
    expect(markup).toContain("教学复习");
    expect(markup).not.toContain("开教学局");

    const finalStep = renderToStaticMarkup(<TutorialView reviewOnly initialStep={2} send={async () => {}} onBack={() => {}} setError={() => {}} openOverlay={() => {}} />);
    expect(finalStep).toContain("复习完成，返回对局");
    expect(finalStep).not.toContain("开教学局");
  });

  it("keeps settings in overlay history while reviewing the tutorial", () => {
    let navigation = { overlay: "menu", history: [] };
    navigation = transitionOverlay(navigation, { type: "open", overlay: "settings" });
    navigation = transitionOverlay(navigation, { type: "open", overlay: "tutorial" });
    navigation = transitionOverlay(navigation, { type: "back" });
    expect(navigation).toEqual({ overlay: "settings", history: ["menu"] });
    navigation = transitionOverlay(navigation, { type: "back" });
    expect(navigation).toEqual({ overlay: "menu", history: [] });
  });

  it("finishes an in-match review without starting or replacing the match", async () => {
    const sent = [];
    let closed = 0;
    await completeTutorial({
      reviewOnly: true,
      send: async (value) => sent.push(value),
      onBack: () => { closed += 1; },
    });
    expect(sent).toEqual([]);
    expect(closed).toBe(1);
  });
});

describe("home tutorial", () => {
  it("still offers and starts the tutorial match after step three", async () => {
    const markup = renderToStaticMarkup(<TutorialView initialStep={2} send={async () => {}} onBack={() => {}} setError={() => {}} openOverlay={() => {}} />);
    expect(markup).toContain("我会了，开教学局！");

    const sent = [];
    let closed = 0;
    await completeTutorial({
      reviewOnly: false,
      send: async (value) => sent.push(value),
      onBack: () => { closed += 1; },
    });
    expect(sent).toEqual([{ type: "StartTutorial" }]);
    expect(closed).toBe(1);
  });
});
