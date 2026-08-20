import { describe, expect, it } from "vitest";
import { normalizeProductView } from "../normalize";
import { ALL_SCREEN_IDS, buildScreen } from "../sceneRegistry";
import type { ScreenModel } from "../model";
import { renderScene } from "./rendererRegistry";

const view = normalizeProductView({
  phase: "MATCH",
  authenticated: true,
  viewerId: "you",
  room: { id: "room", code: "582913", ownerId: "you", maxPlayers: 4, allowBots: true, turnSeconds: 45 },
  matchId: "match",
  deckCount: 18,
  you: {
    id: "you",
    name: "你",
    avatar: "assets/cats/player.png",
    alive: true,
    hand: [
      { token: "attack", type: "ATTACK" },
      { token: "skip", type: "SKIP" },
      { token: "future", type: "SEE_FUTURE" },
    ],
  },
  players: [
    { id: "you", name: "你", avatar: "assets/cats/player.png", alive: true, handCount: 3, ready: true, host: true },
    { id: "orange", name: "阿橘", avatar: "assets/cats/a-ju.png", alive: true, handCount: 5, ready: true },
  ],
  turn: { id: "turn", playerId: "you", number: 4, remaining: 1, direction: "顺时针" },
  legalActions: [{ type: "Draw", turnId: "turn" }],
}, "online");

const options = {
  height: 844,
  safeTop: 24,
  safeBottom: 12,
  capsule: { left: 286, top: 12, right: 376, bottom: 46, width: 90, height: 34 },
  canGoBack: true,
  selectedTokens: ["attack"],
  error: null,
  viewerId: "you",
  displayFont: "MiniGameComic",
} as const;

describe("mini-game scene renderers", () => {
  it("renders every registered scene without a generic fallback", () => {
    for (const id of ALL_SCREEN_IDS) {
      const model = buildScreen(id, {
        view,
        settings: { sound: true, vibration: true },
        joinCode: "582913",
        selectedTokens: ["attack"],
        selectedTargetId: "orange",
        insertionPosition: 2,
      });
      const rendered = renderScene(model, options);

      expect(rendered.template, id).toContain('class="scene');
      expect(rendered.template, id).toContain("assets/ui/backgrounds/comic-bg-390x844.jpg");
      expect(rendered.styles.scene!.height, id).toBe(844);
      model.actions?.forEach((_, index) => expect(rendered.template, `${id}:action-${index}`).toContain(`id="action-${index}"`));
      model.rows?.forEach((_, index) => expect(rendered.template, `${id}:row-${index}`).toContain(`id="row-${index}"`));
      model.cards?.forEach((_, index) => expect(rendered.template, `${id}:card-${index}`).toContain(`id="card-${index}"`));
    }
  });

  it("keeps short-screen controls full-width while reserving the WeChat capsule", () => {
    const model = buildScreen("play-mode", { view });
    const rendered = renderScene(model, { ...options, height: 584, safeTop: 20, safeBottom: 18 });

    expect(rendered.styles.scene!.height).toBe(584);
    expect(rendered.styles.actionButton!.height).toBeGreaterThanOrEqual(48);
    expect(rendered.styles.headerRight!.width).toBeGreaterThanOrEqual(100);
    expect(rendered.styles.sceneBody!.width).toBe(390);
  });

  it("uses aspect-aware images and the packaged display font", () => {
    const model = buildScreen("home", { view });
    const rendered = renderScene(model, options);

    expect(rendered.template).toContain("<fitimage");
    expect(rendered.template).toContain('data-fit="contain"');
    expect(rendered.styles.brandLogoTop!.fontFamily).toBe("MiniGameComic");
  });

  it("keeps source-critical card art contained and the login question on two balanced lines", () => {
    const login = renderScene({
      id: "login",
      title: "炸毛危机",
      subtitle: "今晚谁先炸？",
      heroImage: "assets/cat-cast.png",
    }, options);
    const favor = renderScene({ id: "favor", title: "选择目标玩家", heroImage: "assets/cards/peek.png" }, options);
    const future = renderScene({ id: "future", title: "未来的三张牌", heroImage: "assets/cards/peek.png" }, options);

    expect(login.template).toContain('class="loginBurstLine" value="今晚"');
    expect(login.template).toContain('class="loginBurstLine" value="谁先炸？"');
    expect(favor.template).toContain('class="choiceHero" src="assets/cards/peek.png" data-fit="contain"');
    expect(future.template).toContain('class="choiceHero" src="assets/cards/peek.png" data-fit="contain"');
  });

  it("shows the complete selectable card face when a player chooses a card to give", () => {
    const rendered = renderScene({
      id: "give-card",
      title: "交给对方一张牌",
      cards: [{
        token: "attack",
        type: "ATTACK",
        name: "攻击",
        image: "assets/cards/attack.png",
        playable: true,
        singlePlayable: true,
      }],
    }, options);

    expect(rendered.template).toContain('class="cardList cardListGive"');
    expect(rendered.template).toContain('class="cardItem cardItemGive');
    expect(rendered.template).toContain(
      'class="cardImage giveCardImage" src="assets/cards/attack.png" data-fit="contain"',
    );
  });

  it("shows the complete danger card during the explosion decision", () => {
    const rendered = renderScene({
      id: "explosion",
      title: "砰！你抽到了危险",
      heroImage: "assets/cards/danger.png",
    }, options);

    expect(rendered.template).toContain(
      'class="explosionHero" src="assets/cards/danger.png" data-fit="contain"',
    );
  });

  it("renders Nope and the irreversible pass decision as two explicit actions", () => {
    const model: ScreenModel = {
      id: "response",
      title: "有人要否决吗？",
      actions: [
        { id: "nope", label: "打出否决", tone: "red" },
        { id: "pass", label: "放行 / 关闭", tone: "cream", intent: { type: "PassResponse" } },
      ],
    };
    const rendered = renderScene(model, options);

    expect(rendered.template).toContain(
      'class="responseBackdropCard" src="assets/cards/card-back.png" data-fit="contain"',
    );
    expect(rendered.template).toMatch(/id="action-0"[^>]*actionToneRed[^>]*>[\s\S]*class="actionIcon responseNopeIcon"[\s\S]*value="打出否决"/);
    expect(rendered.template).toMatch(/id="action-1"[^>]*actionLink[^>]*>[\s\S]*src="assets\/ui\/icons\/cream\/check\.png"[\s\S]*value="放行 \/ 关闭"/);
    expect(rendered.template).not.toContain('id="action-1" class="responseClose"');
    expect(rendered.styles.responseNopeIcon).toMatchObject({ transform: "rotate(45deg)" });
  });

  it("keeps the response decision over the live table with an explicit close action and seconds unit", () => {
    const model: ScreenModel = {
      id: "response",
      eyebrow: "否决窗口 · 7 秒",
      title: "要取消这次行动吗？",
      subtitle: "阿橘打出了攻击。",
      heroImage: "assets/cats/xiao-hui.png",
      table: {
        turn: 4,
        direction: "顺时针",
        deckCount: 18,
        hand: view.hand,
        players: view.players,
        myTurn: false,
        turnsOwed: 1,
      },
      actions: [
        { id: "nope", label: "打出否决", tone: "red" },
        { id: "pass", label: "放行", tone: "cream", intent: { type: "PassResponse" } },
      ],
    };

    const rendered = renderScene(model, options);

    expect(rendered.template).toContain('class="responseTableContext"');
    expect(rendered.template).toContain('<canvas id="tableCanvas"');
    expect(rendered.template).toContain('class="responseModal"');
    expect(rendered.template).toContain('class="responseHero" src="assets/cats/xiao-hui.png"');
    expect(rendered.template).toMatch(/id="action-1"[^>]*actionLink[^>]*>[\s\S]*value="放行"/);
    expect(rendered.template).toContain('class="countdownText" value="7"');
    expect(rendered.template).toContain('class="countdownUnit" value="秒"');
  });

  it("marks the local lobby member and spells out their ready state", () => {
    const model: ScreenModel = {
      id: "lobby-member",
      title: "等待开局",
      rows: [
        { id: "you", title: "蓝耳队长", detail: "已准备", badge: "3 张", image: "assets/cats/player.png" },
        { id: "orange", title: "阿橘 · 房主", detail: "等待准备", badge: "5 张", image: "assets/cats/a-ju.png" },
      ],
    };

    const rendered = renderScene(model, options);

    expect(rendered.template).toContain('id="row-0" class="row rowSeat selfSeat"');
    expect(rendered.template).toContain('class="selfBadge" value="你"');
    expect(rendered.template).toContain('class="rowDetail rowDetailSeat" value="正在准备"');
  });

  it("uses the row marked as room owner for the member lobby header", () => {
    const rendered = renderScene({
      id: "lobby-member",
      title: "等待开局",
      subtitle: "正在调整规则",
      rows: [
        { id: "you", title: "蓝耳队长", image: "assets/cats/player.png" },
        { id: "gray", title: "小灰 · 房主", image: "assets/cats/xiao-hui.png" },
      ],
    }, options);

    expect(rendered.template).toContain('class="lobbyHostIcon" src="assets/cats/xiao-hui.png"');
    expect(rendered.template).toContain('class="lobbyHostText" value="小灰 · 正在调整规则"');
  });

  it("renders a host's empty seat as a recognizable invite card instead of a missing avatar", () => {
    const rendered = renderScene({
      id: "lobby-host",
      title: "等待开局",
      rows: [
        { id: "you", title: "你 · 房主", detail: "已准备", image: "assets/cats/player.png" },
        { id: "invite", title: "邀请好友加入", detail: "还有 1 个空位", action: { id: "share", label: "分享", intent: { type: "ShareRoom" } } },
      ],
    }, options);

    expect(rendered.template).toContain('id="row-1" class="row rowSeat rowSelected rowInteractive"');
    expect(rendered.template).toMatch(/id="row-1"[\s\S]*src="assets\/ui\/icons\/cream\/share-network\.png"/);
    expect(rendered.template).toMatch(/id="row-1"[\s\S]*value="邀请好友加入"/);
    expect(rendered.template).toMatch(/id="row-0"[\s\S]*class="rowDetail rowDetailSeat" value="已准备"/);
    expect(rendered.template).not.toMatch(/id="row-0"[\s\S]*value="正在准备"/);
  });

  it("keeps the real host model and renderer aligned on an all-ready lobby", () => {
    const model = buildScreen("lobby-host", { view });
    const rendered = renderScene(model, options);

    expect(model.rows?.find((row) => row.id === "you")?.detail).toBe("已准备");
    expect(model.actions?.some((action) => action.intent?.type === "StartMatch")).toBe(true);
    expect(rendered.template).toMatch(/id="row-0"[\s\S]*class="rowDetail rowDetailSeat" value="已准备"/);
    expect(rendered.template).not.toMatch(/id="row-0"[\s\S]*value="正在准备"/);
  });

  it("renders defuse insertion as a precise two-way stepper with endpoints and current position", () => {
    const model: ScreenModel = {
      id: "defuse",
      title: "把危险放回哪里？",
      subtitle: "牌堆当前共 18 张。位置只有你知道。",
      rows: [
        { id: "position-prev", title: "向牌堆顶移动一格", badge: "向顶", action: { id: "prev", label: "向顶" } },
        { id: "position-current", title: "当前位置：第 10 张", detail: "第 10 / 19 个可选位置", badge: "第 10 张" },
        { id: "position-next", title: "向牌堆底移动一格", badge: "向底", action: { id: "next", label: "向底" } },
      ],
    };

    const rendered = renderScene(model, options);

    expect(rendered.template).toContain('class="defuseSelector"');
    expect(rendered.template).toContain(
      'class="choiceHero" src="assets/cards/defuse.png" data-fit="contain"',
    );
    expect(rendered.template).toContain('class="defuseEndpoint" value="牌堆顶 · 第 1 个位置"');
    expect(rendered.template).toContain('class="defuseEndpoint" value="牌堆底 · 第 19 个位置"');
    expect(rendered.template).toContain('id="row-0" class="defuseStepButton"');
    expect(rendered.template).toContain('id="row-1" class="defusePosition defusePositionSelected"');
    expect(rendered.template).toContain('id="row-2" class="defuseStepButton"');
    expect(rendered.template).toContain('class="defusePositionLabel" value="第 10 张"');
    expect(rendered.template).toContain('class="defusePositionDetail" value="第 10 / 19 个可选位置"');
  });

  it("separates the winner art from the dark background and labels the viewer in rankings", () => {
    const model: ScreenModel = {
      id: "result",
      title: "本局结算",
      subtitle: "成功躲过 3 次危险",
      heroImage: "assets/cats/tuan-zi.png",
      rows: [
        { id: "orange", title: "阿橘", detail: "获胜", badge: "#1", image: "assets/cats/a-ju.png" },
        { id: "you", title: "蓝耳队长", detail: "已淘汰", badge: "#2", image: "assets/cats/player.png" },
      ],
    };

    const rendered = renderScene(model, options);

    expect(rendered.template).toContain('class="winnerAura"');
    expect(rendered.template).toContain('class="winnerImage" src="assets/cats/tuan-zi.png"');
    expect(rendered.template).toMatch(/id="row-1"[\s\S]*class="winnerYou" value="YOU"/);
    expect(rendered.template.indexOf('class="choicePromptDetail"')).toBeLessThan(rendered.template.indexOf('id="row-0"'));
  });

  it("distinguishes adjustable create controls from the fixed ruleset", () => {
    const rendered = renderScene({
      id: "create",
      title: "创建房间",
      rows: [
        { id: "players", title: "玩家人数", detail: "点按切换 2 - 5 人", badge: "4 人", action: { id: "players", label: "切换" } },
        { id: "timer", title: "行动计时", detail: "点按切换 30 / 45 / 60 秒", badge: "45 秒", action: { id: "timer", label: "切换" } },
        { id: "bots", title: "机器人补位", detail: "点按关闭", badge: "已开启", action: { id: "bots", label: "关闭" } },
        { id: "ruleset", title: "规则集（固定）", detail: "当前版本固定", badge: "基础版" },
      ],
    }, options);

    expect(rendered.template).toMatch(/id="row-0" class="formRow rowInteractive"[\s\S]*class="formStepper"/);
    expect(rendered.template).toMatch(/id="row-1" class="formRow rowInteractive"[\s\S]*class="formStepper"/);
    expect(rendered.template).toMatch(/id="row-2" class="formRow formRowDark rowInteractive"[\s\S]*class="toggleSwitch toggleSwitchOn"/);
    expect(rendered.template).toContain('id="row-3" class="formRow formRowStamp"');
    expect(rendered.template).not.toMatch(/id="row-3"[^>]*rowInteractive/);
  });

  it("presents settings as direct switches plus tutorial, rules, and version entries", () => {
    const model: ScreenModel = {
      id: "settings",
      eyebrow: "THIS DEVICE",
      title: "声音与振动",
      heroImage: "assets/cats/xiao-hui.png",
      heroLabel: "小灰",
      rows: [
        { id: "sound", title: "游戏声音", badge: "已开启", action: { id: "sound", label: "切换" } },
        { id: "vibration", title: "触感反馈", badge: "已关闭", action: { id: "vibration", label: "切换" } },
        { id: "tutorial", title: "重看教学", action: { id: "tutorial", label: "打开", next: "tutorial" } },
        { id: "rules", title: "规则图鉴", action: { id: "rules", label: "打开", next: "rules" } },
        { id: "version", title: "规则版本", detail: "original-2025@1" },
      ],
    };

    const rendered = renderScene(model, options);

    expect(rendered.template).toContain('class="eyebrow" value="当前设备"');
    expect(rendered.template).toContain('class="settingsAvatar" src="assets/cats/xiao-hui.png"');
    expect(rendered.template).toContain('class="settingsName" value="小灰"');
    expect(rendered.template).toMatch(/class="[^"]*\bsettingsToggle\b[^"]*\bsettingsToggleOn\b/);
    expect(rendered.template).toMatch(/class="[^"]*\bsettingsToggleKnob\b[^"]*\bsettingsToggleKnobOn\b/);
    expect(rendered.template).toContain('class="settingsToggleLabel settingsToggleLabelOn" value="开"');
    expect(rendered.template).toContain('class="settingsToggleLabel" value="关"');
    expect(rendered.template).toContain('class="settingsLinks"');
    expect(rendered.template).toMatch(/id="row-2"[\s\S]*value="重看教学"/);
    expect(rendered.template).toMatch(/id="row-3"[\s\S]*value="规则图鉴"/);
    expect(rendered.template).toMatch(/id="row-4"[\s\S]*value="original-2025@1"/);
  });

  it("disables the join CTA until a complete six-digit room code is visible", () => {
    const base: ScreenModel = {
      id: "join",
      title: "加入房间",
      rows: [{ id: "room-code", title: "房间码", detail: "" }],
      actions: [
        { id: "join", label: "进入房间", intent: { type: "JoinRoom" } },
        { id: "back", label: "返回", next: "play-mode", tone: "ink" },
      ],
    };

    const invalid = renderScene(base, options);
    const valid = renderScene({ ...base, rows: [{ ...base.rows![0]!, detail: "582913" }] }, options);

    expect(invalid.template).toContain('class="codeValue codePlaceholder" value="· · · · · ·"');
    expect(invalid.template).not.toContain('value="••••••"');
    expect(valid.template).toContain('class="codeValue" value="582913"');
    expect(invalid.template).toMatch(/id="action-0"[^>]*disabledControl[^>]*aria-disabled="true"[^>]*disabled="true"/);
    expect(valid.template).not.toMatch(/id="action-0"[^>]*disabledControl/);
  });

  it("describes truthful private-snapshot recovery with localized state and current-turn progress", () => {
    const model: ScreenModel = {
      id: "network",
      eyebrow: "服务端继续保留本局",
      title: "正在找回牌桌…",
      subtitle: "重连后同步当前回合和你的最新私有状态。",
      heroLabel: "SYNC",
      rows: [
        { id: "state", title: "连接状态", badge: "offline" },
        { id: "turn", title: "当前回合", detail: "第 4 回合 · 等待阿橘" },
        { id: "revision", title: "恢复内容", detail: "全量私有快照", badge: "安全" },
      ],
    };

    const rendered = renderScene(model, options);
    const online = renderScene({ ...model, title: "连接稳定", heroLabel: "已连接", rows: [{ id: "state", title: "连接状态", badge: "在线" }] }, options);

    expect(rendered.template).toContain('class="rowBadge" value="离线重连中"');
    expect(rendered.template).toContain('value="第 4 回合 · 等待阿橘"');
    expect(rendered.template).toContain('class="networkProgressLabel" value="恢复状态：正在同步当前回合与最新私有状态"');
    expect(rendered.template).not.toMatch(/机器人|Bot|60 秒/);
    expect(online.template).toContain('class="networkProgressLabel" value="同步状态：当前回合与私有状态已是最新"');
    expect(rendered.template).toContain('class="networkIcon" src="assets/ui/icons/cream/device-mobile-hero.png" data-fit="contain"');
    expect(online.template).toContain('class="networkIcon" src="assets/ui/icons/cream/check-hero.png" data-fit="contain"');
  });

  it("distinguishes a local demo from server play and fills the online sync track", () => {
    const localModel = buildScreen("network", { view: { ...view, connectivity: "local" } });
    const onlineModel = buildScreen("network", { view: { ...view, connectivity: "online" } });
    const local = renderScene(localModel, options);
    const online = renderScene(onlineModel, options);

    expect(local.template).toContain('class="networkKicker" value="本地演示对局"');
    expect(local.template).toContain('class="networkProgressLabel" value="状态来源：当前回合与私有状态来自本机演示会话"');
    expect(local.template).toContain('class="rowBadge" value="本地演示"');
    expect(local.template).not.toMatch(/服务端权威对局|已与服务器同步|同步完整私有快照/);
    expect(local.template).not.toContain('class="syncTrack"');

    expect(online.template).toContain('class="networkKicker" value="服务端权威对局"');
    const fillClassNames = /<view class="([^"]*\bsyncFill\b[^"]*)"/.exec(online.template)?.[1]?.split(/\s+/) ?? [];
    const fillStyle = Object.assign({}, ...fillClassNames.map((className) => online.styles[className] ?? {})) as Record<string, unknown>;
    const trackStyle = online.styles.syncTrack as Record<string, unknown>;
    expect(fillStyle.width).toBe(Number(trackStyle.width) - (2 * Number(trackStyle.borderWidth)));
  });

  it("makes the current opponent and countdown independently scannable without an oversized attack stamp", () => {
    const table: NonNullable<ScreenModel["table"]> = {
      turn: 4,
      direction: "顺时针",
      deckCount: 18,
      hand: view.hand,
      players: view.players,
      myTurn: false,
      turnsOwed: 2,
    };
    const waiting = renderScene({
      id: "other-turn",
      eyebrow: "第 4 回合 · 顺时针 · 12 秒",
      title: "等待其他玩家行动",
      subtitle: "等待 阿橘 行动 · 还剩 12 秒",
      table,
    }, options);
    const attacked = renderScene({
      id: "attack",
      eyebrow: "第 4 回合 · 顺时针 · 12 秒",
      title: "你还欠 2 个回合！",
      heroLabel: "×2",
      table: { ...table, myTurn: true },
    }, options);

    expect(waiting.template).toContain('class="tableTurnStatus" value="等待 阿橘 行动 · 还剩 12 秒"');
    expect(waiting.template).toContain('class="tableTurnTimerLabel" value="12 秒"');
    expect(waiting.template).toMatch(/class="opponent tableCurrentPlayer"[\s\S]*class="tableCurrentMark" value="当前"/);
    expect(attacked.template).toContain('class="debtStamp warningCallout"');
  });

  it("turns the selected favor target into a full highlighted surface with a textual confirmation", () => {
    const rendered = renderScene({
      id: "favor",
      title: "选择目标玩家",
      rows: [
        { id: "orange", title: "阿橘", detail: "已准备", badge: "已选择", image: "assets/cats/a-ju.png", action: { id: "orange", label: "选择" } },
        { id: "gray", title: "小灰", detail: "已准备", badge: "4 张", image: "assets/cats/xiao-hui.png", action: { id: "gray", label: "选择" } },
      ],
    }, options);

    expect(rendered.template).toContain('id="row-0" class="row rowPaper rowSelected rowInteractive"');
    expect(rendered.template).toMatch(/id="row-0"[\s\S]*class="selectionMark" value="✓ 已选择"/);
    expect(rendered.template).toContain('id="row-1" class="row rowPaper rowInteractive"');
  });

  it("names the recipient before a player confirms which card to give", () => {
    const rendered = renderScene({
      id: "give-card",
      title: "交给对方一张牌",
      subtitle: "点击选择要交出的手牌；只有双方会看到",
      heroLabel: "接收者：阿橘",
      cards: view.hand,
    }, options);

    expect(rendered.template).toContain('class="giveRecipient"');
    expect(rendered.template).toContain('class="giveRecipientLabel" value="接收者：阿橘"');
    expect(rendered.template.indexOf('class="giveRecipient"')).toBeLessThan(rendered.template.indexOf('id="card-0"'));
  });

  it("keeps tutorial progress localized and inside the brand yellow-cyan palette", () => {
    const rendered = renderScene({
      id: "tutorial",
      title: "快速教学",
      heroLabel: "STEP 2",
      heroImage: "assets/cards/attack.png",
      rows: [{ id: "step", title: "别抽到危险猫", detail: "● ● ○" }],
    }, options);

    expect(rendered.template).toContain('class="tutorialStep" value="第 2 步"');
    expect(rendered.template).toContain(
      'class="tutorialImage" src="assets/cards/attack.png" data-fit="contain"',
    );
    expect(rendered.styles.tutorialBurst!.backgroundColor).toBe("#ffc928");
    expect(rendered.styles.tutorialStep!.color).toBe("#46e3ef");
  });

  it("repairs the rules copy and leaves enough scroll space above the fixed action dock", () => {
    const rendered = renderScene({
      id: "rules",
      title: "规则图鉴",
      rows: [{ id: "attack", title: "攻击", detail: "立即结束当前次回合", image: "assets/cards/attack.png", action: { id: "detail", label: "详情", next: "card-detail" } }],
      actions: [{ id: "back", label: "返回", next: "home" }],
    }, options);

    expect(rendered.template).toContain('value="立即结束当前回合"');
    expect(rendered.template).not.toContain("当前次回合");
    expect(rendered.template).toContain(
      'class="rowImage ruleCardImage" src="assets/cards/attack.png" data-fit="contain"',
    );
    expect(rendered.template).toContain('class="rulesBottomSpacer"');
    expect(rendered.template.indexOf('class="rulesBottomSpacer"')).toBeGreaterThan(rendered.template.indexOf('id="row-0"'));
  });

  it("promotes the card's core effect into a dedicated high-contrast rule block", () => {
    const rendered = renderScene({
      id: "card-detail",
      title: "攻击",
      subtitle: "结束你的回合，让下一位玩家承担两个回合。",
      heroImage: "assets/cards/attack.png",
      rows: [{ id: "count", title: "基础牌组数量", badge: "4 张" }],
    }, options);

    expect(rendered.template).toContain(
      'class="detailHero" src="assets/cards/attack.png" data-fit="contain"',
    );
    expect(rendered.template).toContain('class="detailRule" value="核心牌效 · 结束你的回合，让下一位玩家承担两个回合。"');
    expect(rendered.template).not.toContain('class="detailText"');
    expect(rendered.styles.detailRule!.fontSize).toBeGreaterThanOrEqual(13);
    expect(rendered.styles.detailCopy!.minHeight).toBeLessThanOrEqual(64);
  });

  it("uses the timeline rail without a misleading refresh icon on every event", () => {
    const rendered = renderScene({
      id: "history",
      title: "行动记录",
      rows: [{ id: "event", title: "阿橘打出了攻击", detail: "公开信息" }],
    }, options);

    expect(rendered.template).toContain('class="timelineRail"');
    expect(rendered.template).not.toContain('class="timelineIcon"');
    expect(rendered.template).not.toContain('/arrow-clockwise.png');
  });

  it("keeps the safe game-menu return primary and the destructive action outlined", () => {
    const model: ScreenModel = {
      id: "game-menu",
      title: "对局菜单",
      actions: [
        { id: "back", label: "返回牌桌", tone: "cream", next: "game" },
        { id: "concede", label: "认输并继续观战", tone: "red", intent: { type: "Concede" } },
      ],
    };
    const rendered = renderScene(model, options);

    expect(rendered.template).toMatch(/id="action-0" class="[^"]*\bcutCornerCard\b[^"]*\bactionToneCream\b[^"]*\bactionWide\b/);
    expect(rendered.template).toContain('id="action-1" class="actionButton actionToneRed actionLink actionLinkDanger"');
    expect(rendered.template).toContain('class="actionLabel actionLabelRed actionLabelLink"');
    expect(rendered.template).toContain('class="dangerNote warningCallout" value="警告：认输会立即结束你在本局的操作；你仍可继续观战。"');
    expect(rendered.styles.actionLinkDanger!.borderColor).toBe("#f23b20");
  });

  it("omits the concede warning when conceding is not available", () => {
    const rendered = renderScene({
      id: "game-menu",
      title: "对局菜单",
      rows: [{ id: "rules", title: "规则图鉴" }],
      actions: [{ id: "back", label: "返回牌桌", next: "game", tone: "cream" }],
    }, options);

    expect(rendered.template).not.toContain('class="dangerNote warningCallout"');
    expect(rendered.template).not.toContain("认输");
  });
});
