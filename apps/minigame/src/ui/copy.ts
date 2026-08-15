import { CARD_CATALOG as SHARED_CARD_CATALOG } from "@exploding-kitty/presentation-model";
import type { CardModel } from "./model";

export const COPY = {
  brand: "炸毛危机",
  tagline: "危险！毛茸茸！还会炸！",
  original: "原创回合制卡牌游戏",
  enter: "微信一键进入",
  start: "开一局",
  join: "加入房间",
  tutorial: "新手教学",
  rules: "规则图鉴",
  create: "创建房间",
  lobby: "等待开炸",
  game: "牌桌",
} as const;

const CARD_ORDER = ["ATTACK", "FAVOR", "SHUFFLE", "SKIP", "SEE_FUTURE", "DEFUSE", "EXPLODING_KITTEN", "NOPE", "CAT_TACO", "CAT_BEARD", "CAT_POTATO", "CAT_RAINBOW", "CAT_WATERMELON"] as const;

export const CARD_CATALOG: readonly CardModel[] = CARD_ORDER.map((type, index) => {
  const definition = SHARED_CARD_CATALOG[type];
  return { token: `${type.toLowerCase()}-${index + 1}`, type, name: definition.name, image: definition.image, playable: definition.singlePlayable, singlePlayable: definition.singlePlayable };
});

export const RULE_ROWS = [
  { id: "flow", title: "回合流程", detail: "先打任意张牌（也可不打），最后抽 1 张并结束当前欠回合。" },
  { id: "danger", title: "危险猫 × 4", detail: "抽到后立刻处理：拆弹，或者淘汰。", image: "assets/cards/danger.png" },
  { id: "defuse", title: "拆弹 × 6", detail: "化解危险，并秘密放回牌堆。", image: "assets/cards/defuse.png" },
  { id: "nope", title: "否决 × 5", detail: "取消上一张可否决的动作牌。", image: "assets/cards/card-back.png" },
  { id: "attack", title: "攻击 × 4", detail: "结束回合，让下一位承担两个回合。", image: "assets/cards/attack.png" },
  { id: "favor", title: "帮忙 × 4", detail: "指定玩家秘密交给你一张手牌。", image: "assets/cards/reverse.png" },
  { id: "shuffle", title: "洗牌 × 4", detail: "立刻打乱抽牌堆。", image: "assets/cards/shuffle.png" },
  { id: "skip", title: "跳过 × 4", detail: "不抽牌，完成一个欠回合。", image: "assets/cards/skip.png" },
  { id: "future", title: "预见未来 × 5", detail: "秘密查看牌堆顶部三张牌。", image: "assets/cards/peek.png" },
  { id: "cats", title: "猫咪牌 × 20", detail: "5 种图案各 4 张；单张无效果，同名牌可组成组合技。", image: "assets/cards/reverse.png" },
  { id: "combos", title: "两张 / 三张组合", detail: "两张同名随机偷 1 张；三张同名可声明牌型，命中才获得。" },
  { id: "platform", title: "数字平台规则", detail: "点击查看否决窗口、目标限制、超时和并发裁决。" },
] as const;

export const RULE_DETAILS: Readonly<Record<string, Readonly<{
  eyebrow: string;
  title: string;
  subtitle: string;
  image?: string;
  rows: readonly Readonly<{ id: string; title: string; detail?: string; badge?: string }>[];
}>>> = {
  flow: {
    eyebrow: "original-2025@1",
    title: "回合与胜负",
    subtitle: "最后一名未淘汰的玩家获胜。",
    rows: [
      { id: "play", title: "先出牌", detail: "自己的回合可打出任意数量的合法牌，也可以不出。" },
      { id: "draw", title: "最后抽牌", detail: "抽 1 张会完成当前一个欠回合；攻击批次可能仍需继续行动。" },
      { id: "hand", title: "手牌规则", detail: "手牌没有上下限，零手牌不会自动补牌。" },
    ],
  },
  cats: {
    eyebrow: "20 张猫咪牌",
    title: "五种原创猫咪牌",
    subtitle: "卷饼猫、胡须猫、土豆猫、彩虹猫、西瓜猫各 4 张。",
    image: "assets/cards/reverse.png",
    rows: [
      { id: "single", title: "单张无效果", detail: "猫咪牌不能单独打出。" },
      { id: "same", title: "只认同名组合", detail: "首版不使用旧版“五种不同牌”组合。" },
    ],
  },
  combos: {
    eyebrow: "组合技",
    title: "同名牌一起打出",
    subtitle: "组合牌先进入弃牌堆，也可被否决。",
    rows: [
      { id: "pair", title: "两张同名", detail: "选择一名仍存活且有手牌的玩家，由服务器随机偷取 1 张。" },
      { id: "triple", title: "三张同名", detail: "选择任意存活玩家并声明一种牌；对方有则获得，没有则落空。" },
      { id: "lock", title: "提交时锁定", detail: "目标和声明牌型不会在否决后重新选择。" },
    ],
  },
  platform: {
    eyebrow: "数字平台补充规则",
    title: "联网裁决说明",
    subtitle: "这些时机由权威服务器统一处理。",
    rows: [
      { id: "nope", title: "否决窗口 · 5 秒", detail: "服务端先收到的合法否决优先；否决另一张否决会让原动作重新生效。" },
      { id: "pass", title: "放行不可反悔", detail: "本窗口点击放行后不能再改为否决；全员放行可提前结算。" },
      { id: "choice", title: "私密选择 · 15 秒", detail: "帮忙赠牌和拆弹位置超时后由服务器按确定性随机合法代选。" },
      { id: "target", title: "目标限制", detail: "帮忙与两张组合只能选有手牌的存活玩家；三张组合可对空手玩家落空。" },
      { id: "clock", title: "回合计时", detail: "以房间设置的 30 / 45 / 60 秒和服务端时钟为准。" },
    ],
  },
};
