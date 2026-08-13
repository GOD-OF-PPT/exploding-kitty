export const RULESET_VERSION = "original-2025@1" as const;
export const KERNEL_VERSION = "2.0.0" as const;
export const CARD_CATALOG_VERSION = "original-2025-cards@1" as const;
export const PRNG_VERSION = "chacha20-sha256@1" as const;
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

/** Serializable ChaCha20 cursor. Persisting it makes every random choice replayable. */
export type DeterministicRandomState = Readonly<{
  key: readonly number[];
  nonce: readonly number[];
  counter: number;
  buffer: readonly number[];
  offset: number;
}>;

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
  rngState: DeterministicRandomState;
  /** Monotonic public turn ordinal. Older persisted states are normalized on the next command. */
  turnNumber: number;
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
  /** Server-generated entropy or a deterministic test/replay seed. */
  seed?: number | string | Uint8Array;
  firstPlayerId?: string;
  matchId?: string;
  now?: number;
  turnDurationMs?: number;
  responseWindowMs?: number;
  choiceDurationMs?: number;
};

type PlayerCommand = { commandId: string; actorId: string };

export type GameCommand =
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

/** @deprecated Use GameCommand. Retained for replay compatibility. */
export type Command = GameCommand;

export type PlayerGameCommand = Exclude<GameCommand, { type: "DeadlineElapsed" }>;
export type DeadlineElapsedCommand = Extract<GameCommand, { type: "DeadlineElapsed" }>;

export type LegalAction = {
  type: GameCommand["type"];
  turnId?: string;
  windowId?: string;
  promptId?: string;
  cardIds?: string[];
};

export type PendingView =
  | { kind: "RESPONSE"; windowId: string; actorId: string; cardTypes: CardType[]; nopeCount: number; deadlineId: string; deadline: number; viewerPassed: boolean; canPass: boolean }
  | { kind: "FAVOR_CHOICE"; promptId: string; requesterId: string; targetId: string; deadlineId: string; deadline: number }
  | { kind: "PRIVATE_PEEK"; promptId: string; playerId: string; cards: Card[]; deadlineId: string; deadline: number }
  | { kind: "EXPLOSION"; promptId: string; playerId: string; deadlineId: string; deadline: number }
  | { kind: "DEFUSE_INSERTION"; promptId?: string; playerId: string; deadlineId: string; deadline: number }
  | { kind: "WAITING_PRIVATE_CHOICE"; playerId: string; deadlineId: string; deadline: number; requesterId?: string };

export type PlayerView = {
  rulesetVersion: typeof RULESET_VERSION;
  matchId: string;
  sequence: number;
  turnNumber: number;
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
