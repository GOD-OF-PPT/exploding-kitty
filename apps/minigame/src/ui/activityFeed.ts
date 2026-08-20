import type { PublicEvent } from "@exploding-kitty/presentation-model";
import { CARD_CATALOG } from "./copy";
import type { ProductViewModel } from "./normalize";

export type ActivityTone = "neutral" | "action" | "danger" | "success";

export type ActivityItem = Readonly<{
  sequence: number;
  title: string;
  detail: string;
  actorId?: string;
  tone: ActivityTone;
  turnNumber: number;
}>;

export function activityItem(
  event: PublicEvent,
  view: ProductViewModel,
  turnNumber = turnNumberAt(view.events, event.sequence),
): ActivityItem {
  const actor = playerName(view, event.actorId);
  const card = event.cardType ? cardName(event.cardType) : "";
  const playedCards = event.cardTypes?.map(cardName) ?? [];
  const target = playerName(view, event.targetId);
  const from = playerName(view, event.fromId);
  const to = playerName(view, event.toId);
  const count = Math.max(1, Number(event.count) || 1);
  const common = {
    sequence: event.sequence,
    detail: turnNumber > 0 ? `第 ${turnNumber} 回合` : "公开行动",
    ...(event.actorId ? { actorId: event.actorId } : {}),
    turnNumber,
  };

  switch (event.type) {
    case "MATCH_STARTED": return { ...common, title: "牌局开始，危险猫已混入牌堆", tone: "action" };
    case "TURN_STARTED": return { ...common, title: `轮到${actor}行动`, tone: "neutral" };
    case "CARDS_COMMITTED": return {
      ...common,
      title: `${playedCardTitle(actor, playedCards, card, count)}${event.targetId ? `，目标${target}` : ""}`,
      tone: "action",
    };
    case "NOPE_PLAYED": return { ...common, title: `${actor}打出「否决」`, tone: "danger" };
    case "RESPONSE_PASSED": return { ...common, title: `${actor}选择放行`, tone: "neutral" };
    case "ACTION_CANCELLED": return {
      ...common,
      title: `${actor}的行动被取消`,
      detail: reasonLabel(event.reason) ?? common.detail,
      tone: "danger",
    };
    case "ACTION_RESOLVED": return {
      ...common,
      title: playedCards.length ? `「${playedCards[0]}」已生效` : `${actor}的行动已生效`,
      tone: "success",
    };
    case "CARD_STOLEN": return {
      ...common,
      title: card ? `${to}从${from}获得「${card}」` : `${to}从${from}获得一张牌`,
      tone: "action",
    };
    case "CARD_GIVEN": return {
      ...common,
      title: card ? `${from}交给${to}「${card}」` : `${from}交给${to}一张牌`,
      tone: "action",
    };
    case "COMBO_MISSED": return {
      ...common,
      title: event.declaredCardType
        ? `${actor}索要「${cardName(event.declaredCardType)}」但没有命中`
        : `${actor}的组合技没有命中`,
      tone: "neutral",
    };
    case "CARD_DRAWN": return { ...common, title: `${actor}抽了一张牌`, tone: "neutral" };
    case "DECK_SHUFFLED": return { ...common, title: `${actor}洗乱了牌堆`, tone: "action" };
    case "EXPLODING_KITTEN_REVEALED": return { ...common, title: `${actor}抽到了危险猫！`, tone: "danger" };
    case "DEFUSE_CONSUMED": return { ...common, title: `${actor}使用拆弹化解危机`, tone: "success" };
    case "PLAYER_ELIMINATED": return {
      ...common,
      title: `${actor}被淘汰`,
      detail: event.reason === "CONCEDE" ? "主动退出本局" : "被危险猫炸出局",
      tone: "danger",
    };
    case "GAME_FINISHED": return { ...common, title: event.winnerId ? `${playerName(view, event.winnerId)}赢得本局` : "本局胜负已定", tone: "success" };
    default: return { ...common, title: "牌局状态已更新", tone: "neutral" };
  }
}

export function activityTimeline(view: ProductViewModel, limit = 12): readonly ActivityItem[] {
  let turnNumber = 0;
  const items = view.events.map((event) => {
    if (event.type === "TURN_STARTED") turnNumber += 1;
    return activityItem(event, view, turnNumber);
  });
  return items.slice(Math.max(0, items.length - limit));
}

export function latestActivity(view: ProductViewModel): ActivityItem | null {
  const event = view.events.at(-1);
  return event ? activityItem(event, view) : null;
}

export function latestActivitySequence(view: ProductViewModel): number {
  return view.events.reduce((latest, event) => Math.max(latest, event.sequence), 0);
}

function playerName(view: ProductViewModel, playerId: string | undefined): string {
  if (!playerId) return "一名玩家";
  if (playerId === view.viewerId) return "你";
  return view.players.find((player) => player.id === playerId)?.name ?? "一名玩家";
}

function cardName(type: string): string {
  return CARD_CATALOG.find((card) => card.type === type)?.name ?? "动作牌";
}

function turnNumberAt(events: readonly PublicEvent[], sequence: number): number {
  return events.filter((event) => event.type === "TURN_STARTED" && event.sequence <= sequence).length;
}

function reasonLabel(reason: string | undefined): string | null {
  if (reason === "TARGET_UNAVAILABLE" || reason === "TARGET_ELIMINATED") return "目标已经无法行动";
  if (reason === "ACTOR_ELIMINATED" || reason === "PLAYER_ELIMINATED") return "行动玩家已经出局";
  return null;
}

function playedCardTitle(actor: string, cardNames: readonly string[], fallbackCard: string, count: number): string {
  if (!cardNames.length) return fallbackCard ? `${actor}打出「${fallbackCard}」` : `${actor}打出 ${count} 张牌`;
  if (cardNames.every((name) => name === cardNames[0])) {
    return cardNames.length === 1
      ? `${actor}打出「${cardNames[0]}」`
      : `${actor}打出 ${cardNames.length} 张「${cardNames[0]}」`;
  }
  return `${actor}打出${cardNames.map((name) => `「${name}」`).join(" + ")}`;
}
