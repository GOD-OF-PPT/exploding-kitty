export const RULESET_VERSION = "original-2025@1" as const;
export const KERNEL_VERSION = "1.0.0" as const;
export const CARD_CATALOG_VERSION = "original-2025-cards@1" as const;
export const PRNG_VERSION = "xorshift32@1" as const;
export const EVENT_SCHEMA_VERSION = 1 as const;

export type CardType =
  | "EXPLODING_KITTEN"
  | "DEFUSE"
  | "NOPE"
  | "ATTACK"
  | "FAVOR"
  | "SHUFFLE"
  | "SKIP"
  | "SEE_FUTURE"
  | "CAT_TACO"
  | "CAT_BEARD"
  | "CAT_POTATO"
  | "CAT_RAINBOW"
  | "CAT_WATERMELON";

export type Card = Readonly<{ id: string; type: CardType }>;

export type PlayerState = {
  id: string;
  alive: boolean;
  conceded: boolean;
  hand: Card[];
};

export type TurnBatch = {
  id: string;
  playerId: string;
  remaining: number;
  source: "NORMAL" | "ATTACK";
  deadlineId: string;
  deadline: number;
};

export type CommittedAction = {
  actorId: string;
  turnId: string;
  cardIds: string[];
  cardType: CardType;
  mode: "SINGLE" | "PAIR" | "TRIPLE";
  targetId?: string;
  declaredCardType?: CardType;
};

export type ResponseWindow = {
  kind: "RESPONSE";
  windowId: string;
  deadlineId: string;
  deadline: number;
  action: CommittedAction;
  nopeCount: number;
  passedPlayerIds: string[];
};

export type FavorChoice = {
  kind: "FAVOR_CHOICE";
  promptId: string;
  deadlineId: string;
  deadline: number;
  requesterId: string;
  targetId: string;
};

export type PeekAcknowledgement = {
  kind: "PRIVATE_PEEK";
  promptId: string;
  deadlineId: string;
  deadline: number;
  playerId: string;
  cards: Card[];
};

export type ExplosionPrompt = {
  kind: "EXPLOSION";
  promptId: string;
  deadlineId: string;
  deadline: number;
  playerId: string;
  explodingCard: Card;
};

export type DefuseInsertion = {
  kind: "DEFUSE_INSERTION";
  promptId: string;
  deadlineId: string;
  deadline: number;
  playerId: string;
  explodingCard: Card;
};

export type Pending = ResponseWindow | FavorChoice | PeekAcknowledgement | ExplosionPrompt | DefuseInsertion;

export type DomainEvent = {
  sequence: number;
  type: string;
  [key: string]: unknown;
};

export type GameState = {
  rulesetVersion: typeof RULESET_VERSION;
  kernelVersion: typeof KERNEL_VERSION;
  cardCatalogVersion: typeof CARD_CATALOG_VERSION;
  prngVersion: typeof PRNG_VERSION;
  eventSchemaVersion: typeof EVENT_SCHEMA_VERSION;
  matchId: string;
  status: "ACTIVE" | "FINISHED";
  winnerId?: string;
  order: string[];
  players: Record<string, PlayerState>;
  deck: Card[];
  discard: Card[];
  removed: Card[];
  eliminatedZone: Array<{ ownerId: string; card: Card; faceUp: boolean }>;
  turn: TurnBatch | null;
  pending: Pending | null;
  privatePeeks: Record<string, Card[]>;
  rngState: number;
  sequence: number;
  events: DomainEvent[];
  commandResults: Record<string, { sequence: number }>;
  nextId: number;
  clock: number;
  config: {
    turnDurationMs: number;
    responseWindowMs: number;
    choiceDurationMs: number;
  };
};

export type CreateMatchOptions = {
  playerIds: string[];
  seed?: number | string;
  firstPlayerId?: string;
  matchId?: string;
  now?: number;
  turnDurationMs?: number;
  responseWindowMs?: number;
  choiceDurationMs?: number;
};

type PlayerCommand = { commandId: string; actorId: string };

export type Command =
  | (PlayerCommand & { type: "Draw"; turnId: string })
  | (PlayerCommand & {
      type: "PlayCards";
      turnId: string;
      cardIds: string[];
      targetId?: string;
      declaredCardType?: CardType;
    })
  | (PlayerCommand & { type: "PlayNope"; windowId: string; cardId: string })
  | (PlayerCommand & { type: "PassResponse"; windowId: string })
  | (PlayerCommand & { type: "Choose"; promptId: string; value: string | number | { cardId?: string; position?: number; acknowledged?: boolean } })
  | (PlayerCommand & { type: "UseDefuse"; promptId: string; cardId: string })
  | (PlayerCommand & { type: "Concede" })
  | { type: "DeadlineElapsed"; commandId: string; deadlineId: string; now?: number };

export type LegalAction = {
  type: Command["type"];
  turnId?: string;
  windowId?: string;
  promptId?: string;
  cardIds?: string[];
};

export type PendingView =
  | { kind: "RESPONSE"; windowId: string; actorId: string; cardTypes: CardType[]; nopeCount: number; deadline: number }
  | { kind: "FAVOR_CHOICE"; promptId: string; requesterId: string; targetId: string; deadline: number }
  | { kind: "PRIVATE_PEEK"; promptId: string; playerId: string; cards: Card[]; deadline: number }
  | { kind: "EXPLOSION"; promptId: string; playerId: string; deadline: number }
  | { kind: "DEFUSE_INSERTION"; promptId?: string; playerId: string; deadline: number }
  | { kind: "WAITING_PRIVATE_CHOICE"; playerId: string; deadline: number };

export type PlayerView = {
  rulesetVersion: typeof RULESET_VERSION;
  matchId: string;
  sequence: number;
  status: GameState["status"];
  winnerId?: string;
  you: { id: string; alive: boolean; hand: Card[] };
  players: Array<{ id: string; alive: boolean; handCount: number }>;
  deckCount: number;
  discard: Card[];
  eliminatedZone: Array<{ ownerId: string; faceUp: boolean; card?: Card }>;
  turn: TurnBatch | null;
  pending: PendingView | null;
  privatePeek: Card[];
};
