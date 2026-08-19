import type { CardType, GameState } from "@exploding-kitty/game-core";

export type AuthContext = Readonly<{
  playerId: string;
  sessionToken: string;
  displayName?: string;
  avatarUrl?: string;
}>;

export type PlayerProfile = Readonly<{
  id: string;
  name: string;
  avatar?: string;
  bot: boolean;
}>;

export type RoomSettings = Readonly<{
  maxPlayers: 2 | 3 | 4 | 5;
  turnSeconds: 30 | 45 | 60;
  responseSeconds: 5;
  choiceSeconds: 15;
  allowBots: boolean;
  rulesetVersion: "original-2025@1";
}>;

export type RoomMember = PlayerProfile & Readonly<{
  ready: boolean;
  connected: boolean;
}>;

export type RoomRecord = Readonly<{
  id: string;
  code: string;
  ownerId: string;
  /** Server-owned mode flag. Clients cannot turn an ordinary room into a tutorial room. */
  tutorial: boolean;
  settings: RoomSettings;
  members: readonly RoomMember[];
  status: "LOBBY" | "ACTIVE" | "FINISHED";
  matchId?: string;
  revision: number;
  restartVotes?: readonly string[];
  createdAt: number;
}>;

export type CardTokenRecord = Readonly<{
  token: string;
  cardId: string;
  ownerId: string;
}>;

export type DeadlineRecord = Readonly<{
  matchId: string;
  deadlineId: string;
  deadlineAt: number;
}>;

export type MatchRecord = Readonly<{
  id: string;
  roomId: string;
  revision: number;
  state: GameState;
  tokens: readonly CardTokenRecord[];
  deadline: DeadlineRecord | null;
  createdAt: number;
  updatedAt: number;
}>;

export type CommandProblem = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export type CommandReceipt =
  | Readonly<{ ok: true; commandId: string; revision: number }>
  | Readonly<{ ok: false; commandId: string; revision: number; problem: CommandProblem }>;

export type StoredReceipt = Readonly<{
  matchId: string;
  actorId: string;
  commandId: string;
  /** Canonical wire action used to reject command-id reuse with a different payload. */
  fingerprint: string;
  receipt: CommandReceipt;
  createdAt: number;
}>;

export type StoredRoomReceipt = Readonly<{
  roomId: string;
  actorId: string;
  commandId: string;
  /** Canonical wire action used to reject command-id reuse with a different payload. */
  fingerprint: string;
  receipt: CommandReceipt;
  createdAt: number;
}>;

export type StoredSessionCommandReceipt = Readonly<{
  actorId: string;
  commandId: string;
  fingerprint: string;
  receipt: CommandReceipt;
  snapshot?: MatchSnapshot;
  createdAt: number;
}>;

export type AuditEvent = Readonly<{
  matchId: string;
  revision: number;
  sequence: number;
  type: string;
  actorId?: string;
  createdAt: number;
}>;

export type RoomAuditEvent = Readonly<{
  roomId: string;
  revision: number;
  type: string;
  actorId?: string;
  createdAt: number;
}>;

export type ClientCard = Readonly<{ token: string; type: CardType }>;

export type MatchSnapshot = Readonly<{
  phase: "HOME" | "LOBBY" | "MATCH" | "FINISHED";
  viewerId: string;
  serverTime: number;
  room?: Readonly<{
    id: string;
    code: string;
    ownerId: string;
    tutorial: boolean;
    maxPlayers: number;
    allowBots: boolean;
    turnSeconds: number;
    rulesetVersion: string;
  }>;
  matchId?: string;
  status?: "ACTIVE" | "FINISHED";
  winnerId?: string;
  you?: Readonly<{ id: string; alive: boolean; hand: readonly ClientCard[] }>;
  players?: readonly Readonly<{
    id: string;
    name: string;
    avatar?: string;
    handCount: number;
    alive: boolean;
    ready: boolean;
    bot: boolean;
    connected: boolean;
  }>[];
  restartVotes?: readonly string[];
  deckCount?: number;
  discard?: readonly Readonly<{ type: CardType }>[];
  turn?: Readonly<{
    id: string;
    playerId: string;
    number: number;
    remaining: number;
    direction: "CLOCKWISE";
    deadlineAt: number;
    deadlineId: string;
  }> | null;
  pending?: Readonly<{
    id: string;
    kind: "RESPONSE" | "EXPLOSION" | "DEFUSE_INSERTION" | "PRIVATE_PEEK" | "GIVE_CARD" | "WAITING_PRIVATE_CHOICE";
    deadlineAt?: number;
    windowId?: string;
    promptId?: string;
    cards?: readonly Readonly<{ type: CardType }>[];
    actorId?: string;
    targetId?: string;
    declaredCardType?: CardType;
    requesterId?: string;
    playerId?: string;
    cardTypes?: readonly CardType[];
    nopeCount?: number;
    viewerPassed?: boolean;
    canPass?: boolean;
    deckSize?: number;
  }> | null;
  privatePeek?: readonly Readonly<{ type: CardType }>[];
  legalActions?: readonly Readonly<{ type: string; turnId?: string; windowId?: string; promptId?: string; cardTokens?: readonly string[] }>[];
  events?: readonly Readonly<{
    sequence: number;
    type: string;
    actorId?: string;
    cardType?: CardType;
    count?: number;
    reason?: string;
  }>[];
  rankings?: readonly Readonly<{ playerId: string; rank: number; reason?: string }>[];
}>;

export type RoomSnapshot = Readonly<{
  revision: number;
  snapshot: MatchSnapshot;
}>;
