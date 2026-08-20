import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SCENE_RENDERERS } from "../../src/ui/rendering/rendererRegistry";
import {
  PROTOTYPE_REFERENCE_FILES,
  SCREEN_FIXTURES,
  SCREEN_ORDER,
  SHORT_SCREEN_FAMILY_REPRESENTATIVES,
} from "./fixtures";

const RENDER_OPTIONS = {
  height: 844,
  safeTop: 24,
  safeBottom: 12,
  capsule: null,
  canGoBack: true,
  selectedTokens: [],
  error: null,
  viewerId: "viewer",
  displayFont: "MiniGameComic",
} as const;

describe("visual preview fixtures", () => {
  it("covers every renderer exactly once in the fixed capture order", () => {
    expect(SCREEN_ORDER).toHaveLength(25);
    expect(new Set(SCREEN_ORDER).size).toBe(SCREEN_ORDER.length);
    expect(Object.keys(SCREEN_FIXTURES)).toEqual([...SCREEN_ORDER]);
    expect(Object.keys(SCENE_RENDERERS)).toEqual([...SCREEN_ORDER]);
    expect(SCREEN_ORDER.map((id) => SCREEN_FIXTURES[id].id)).toEqual([...SCREEN_ORDER]);
  });

  it("provides one short-screen representative for every scene family", () => {
    expect(Object.keys(SHORT_SCREEN_FAMILY_REPRESENTATIVES)).toEqual([
      "brand",
      "room-entry",
      "lobby",
      "table",
      "choice",
      "outcome",
      "editorial",
      "utility",
    ]);
    expect(new Set(Object.values(SHORT_SCREEN_FAMILY_REPRESENTATIVES)).size).toBe(8);
  });

  it("maps every screen to a unique prototype reference", () => {
    expect(Object.keys(PROTOTYPE_REFERENCE_FILES)).toEqual([...SCREEN_ORDER]);
    expect(new Set(Object.values(PROTOTYPE_REFERENCE_FILES)).size).toBe(SCREEN_ORDER.length);
  });

  it("keeps the join comparison on the empty-code disabled state", () => {
    const [roomCode] = SCREEN_FIXTURES.join.rows ?? [];
    const [primaryAction] = SCREEN_FIXTURES.join.actions ?? [];

    expect(roomCode).toEqual({
      id: "room-code",
      title: "房间码",
      detail: "",
      badge: "6 位数字",
    });
    expect(/^\d{6}$/.test(roomCode?.detail ?? "")).toBe(false);
    expect(primaryAction).toEqual({
      id: "join",
      label: "进入房间",
      tone: "yellow",
    });
    expect(SCENE_RENDERERS.join(SCREEN_FIXTURES.join, RENDER_OPTIONS))
      .toMatch(/<button id="action-0"[^>]*aria-disabled="true"/);
  });

  it("keeps the host lobby on three ready players plus one shareable empty seat", () => {
    expect(SCREEN_FIXTURES["lobby-host"].rows).toEqual([
      {
        id: "viewer",
        title: "你 · 房主",
        detail: "已准备",
        image: "assets/cats/player.png",
      },
      {
        id: "orange",
        title: "阿橘",
        detail: "已准备",
        image: "assets/cats/a-ju.png",
      },
      {
        id: "gray",
        title: "小灰",
        detail: "已准备",
        image: "assets/cats/xiao-hui.png",
      },
      {
        id: "invite",
        title: "邀请好友",
        detail: "还差 1 人",
        action: {
          id: "share-empty-seat",
          label: "邀请好友",
          tone: "cream",
          intent: { type: "ShareRoom" },
        },
      },
    ]);
    expect(SCREEN_FIXTURES["lobby-host"].actions).toContainEqual(expect.objectContaining({
      id: "share",
      intent: { type: "ShareRoom" },
    }));
  });

  it("keeps the member lobby identity, host, and ready states aligned", () => {
    expect(SCREEN_FIXTURES["lobby-member"].rows).toEqual([
      {
        id: "viewer",
        title: "你",
        detail: "已准备",
        image: "assets/cats/player.png",
      },
      {
        id: "orange",
        title: "阿橘 · 房主",
        detail: "已准备",
        image: "assets/cats/a-ju.png",
      },
      {
        id: "gray",
        title: "小灰",
        detail: "已准备",
        image: "assets/cats/xiao-hui.png",
      },
      {
        id: "white",
        title: "团子",
        detail: "已准备",
        image: "assets/cats/tuan-zi.png",
      },
    ]);
    expect(SCREEN_FIXTURES["lobby-member"].actions?.[0]).toMatchObject({
      id: "ready",
      label: "取消准备",
      intent: { type: "SetReady" },
    });
    expect(SCENE_RENDERERS["lobby-member"](SCREEN_FIXTURES["lobby-member"], RENDER_OPTIONS))
      .toContain('class="rowDetail rowDetailSeat" value="正在准备"');
  });

  it("keeps the response comparison on the active table, actor, countdown, and close action", () => {
    const fixture = SCREEN_FIXTURES.response;

    expect(fixture).toMatchObject({
      eyebrow: "否决窗口 · 4 秒",
      heroImage: "assets/cats/a-ju.png",
      heroLabel: "4 秒",
      table: { myTurn: false },
    });
    expect(fixture.subtitle).toContain("阿橘打出了攻击");
    expect(fixture.actions).toEqual([
      {
        id: "nope",
        label: "打出否决",
        tone: "red",
        intent: { type: "PlayNope" },
      },
      {
        id: "pass",
        label: "放行 / 关闭",
        tone: "cream",
        intent: { type: "PassResponse" },
      },
    ]);
  });

  it("keeps defuse on a bidirectional 19-position stepper", () => {
    expect(SCREEN_FIXTURES.defuse.rows).toEqual([
      expect.objectContaining({ id: "position-prev", action: expect.objectContaining({ intent: { type: "CycleInsertionPosition", delta: -1 } }) }),
      expect.objectContaining({ id: "position-current", detail: "第 10 / 19 个可选位置", badge: "第 10 张" }),
      expect.objectContaining({ id: "position-next", action: expect.objectContaining({ intent: { type: "CycleInsertionPosition", delta: 1 } }) }),
    ]);
  });

  it("names 团子 consistently as the give-card recipient", () => {
    expect(SCREEN_FIXTURES["give-card"]).toMatchObject({
      title: "交给团子一张牌",
      subtitle: "接收者：团子 · 已选择：攻击",
      heroImage: "assets/cats/tuan-zi.png",
      heroLabel: "接收者：团子",
      actions: [
        {
          id: "give",
          label: "交给团子",
          intent: { type: "ChooseCard" },
        },
      ],
    });
  });

  it("keeps the result comparison on the current-user win and reference ranking", () => {
    expect(SCREEN_FIXTURES.result).toMatchObject({
      heroImage: "assets/cats/player.png",
      heroLabel: "WINNER · YOU",
      subtitle: "成功躲过 3 次危险",
    });
    expect(SCREEN_FIXTURES.result.rows).toEqual([
      {
        id: "viewer",
        title: "你 · 蓝耳队长",
        detail: "你赢得了本局",
        badge: "YOU · #1",
        image: "assets/cats/player.png",
      },
      {
        id: "orange",
        title: "阿橘",
        detail: "炸毛",
        badge: "#2",
        image: "assets/cats/a-ju.png",
      },
      {
        id: "gray",
        title: "小灰",
        detail: "炸毛",
        badge: "#3",
        image: "assets/cats/xiao-hui.png",
      },
      {
        id: "white",
        title: "团子",
        detail: "炸毛",
        badge: "#4",
        image: "assets/cats/tuan-zi.png",
      },
    ]);
  });

  it("uses truthful recovery copy and preserves the current-turn context", () => {
    const fixture = SCREEN_FIXTURES.network;

    expect(fixture).toMatchObject({
      eyebrow: "服务端权威对局",
      title: "正在恢复当前牌桌…",
      subtitle: "对局仍由服务器继续处理。重连后会同步当前回合与你的最新私有状态，不会代你自动出牌。",
      heroLabel: "正在同步",
      rows: [
        {
          id: "state",
          title: "连接状态",
          detail: "网络恢复后会自动同步",
          badge: "离线，等待重连",
        },
        {
          id: "turn",
          title: "当前回合",
          detail: "阿橘正在行动",
          badge: "第 8 回合",
        },
        {
          id: "revision",
          title: "恢复方式",
          detail: "同步完整私有快照",
          badge: "安全",
        },
      ],
      actions: [
        {
          id: "retry",
          label: "立即重试",
          intent: { type: "Reconnect" },
        },
      ],
    });
    expect(`${fixture.eyebrow} ${fixture.title} ${fixture.subtitle}`)
      .not.toMatch(/60\s*秒|Bot|机器人托管/);
  });

  it("keeps the settings profile, device toggles, help links, and version visible", () => {
    expect(SCREEN_FIXTURES.settings).toMatchObject({
      eyebrow: "当前设备",
      title: "设置",
      heroImage: "assets/cats/player.png",
      heroLabel: "蓝耳队长",
      rows: [
        {
          id: "sound",
          title: "游戏声音",
          detail: "卡牌与危险提示音",
          badge: "已开启",
          action: {
            id: "toggle-sound",
            label: "关闭声音",
            intent: { type: "ToggleSound" },
          },
        },
        {
          id: "vibration",
          title: "触感反馈",
          detail: "出牌与危险提示",
          badge: "已开启",
          action: {
            id: "toggle-vibration",
            label: "关闭触感",
            intent: { type: "ToggleVibration" },
          },
        },
        {
          id: "tutorial",
          title: "重看新手教学",
          detail: "重新查看三步基础教学",
          action: {
            id: "tutorial",
            label: "打开教学",
            next: "tutorial",
          },
        },
        {
          id: "rules",
          title: "规则与版本",
          detail: "查看卡牌、组合与平台规则",
          action: {
            id: "rules",
            label: "打开规则",
            next: "rules",
          },
        },
        {
          id: "version",
          title: "当前版本",
          detail: "original-2025@1",
          badge: "基础版",
        },
      ],
    });
  });

  it("keeps the eliminated fixture aligned with the production two-action dock", () => {
    const actions = SCREEN_FIXTURES.eliminated.actions ?? [];

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      id: "spectate",
      label: "继续观战",
      next: "other-turn",
    });
    expect(actions[1]).toMatchObject({
      id: "leave",
      label: "退出房间",
      tone: "ink",
      intent: { type: "LeaveRoom" },
    });
  });

  it("uses the source-truth Favor card for the target-selection hero", () => {
    expect(SCREEN_FIXTURES.favor.heroImage).toBe("assets/cards/peek.png");
  });

  it("keeps table fixtures renderable and excludes unstable data sources", () => {
    for (const id of ["game", "other-turn", "attack"] as const) {
      expect(SCREEN_FIXTURES[id].table).toBeDefined();
    }
    const source = readFileSync(new URL("./fixtures.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Date(?:\.now)?\s*\(|Math\.random\s*\(|fetch\s*\(|(?:local|session)Storage/);
  });

  it("matches ScreenHost font and laid-out table surface sizing", () => {
    const source = readFileSync(new URL("./renderCanvas.ts", import.meta.url), "utf8");
    expect(source).toMatch(/displayFont:\s*DISPLAY_FONT/);
    expect(source).toMatch(/component\.layoutBox\.width/);
    expect(source).toMatch(/component\.layoutBox\.height/);
    expect(source).not.toMatch(/width:\s*358,\s*\n\s*height:\s*520/);
  });

  it("provides a shell-free fixed-size comparison capture surface", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(main).toContain('params.get("capture") === "evidence"');
    expect(main).toContain('id="evidence-frame" width="964" height="964"');
    expect(main).toContain("composeEvidenceFrame(previewCanvas)");
    expect(styles).toContain('body[data-capture="evidence"]');
    expect(styles).toMatch(/width:\s*964px;\s*height:\s*964px/);
  });

});
