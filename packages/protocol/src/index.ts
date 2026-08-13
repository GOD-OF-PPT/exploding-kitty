import type { CardType } from "@exploding-kitty/game-core";

export const PROTOCOL_VERSION = 1 as const;

export type WireProblem = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export type RoomSettingsDto = Readonly<{
  maxPlayers: 2 | 3 | 4 | 5;
  turnSeconds: 30 | 45 | 60;
  responseSeconds: 5;
  choiceSeconds: 15;
  allowBots: boolean;
  rulesetVersion: "original-2025@1";
}>;

export type LoginAction = Readonly<{
  type: "Login";
  provider: "wechat";
  loginCode: string;
  profile?: Readonly<{ displayName?: string; avatarUrl?: string }>;
}>;
export type CreateRoomAction = Readonly<{ type: "CreateRoom"; settings: RoomSettingsDto }>;
export type JoinRoomAction = Readonly<{ type: "JoinRoom"; code: string }>;
export type SetReadyAction = Readonly<{ type: "SetReady"; ready: boolean }>;
export type AddBotAction = Readonly<{ type: "AddBot" }>;
export type RemoveBotAction = Readonly<{ type: "RemoveBot"; playerId: string }>;
export type StartMatchAction = Readonly<{ type: "StartMatch" }>;
export type StartTutorialAction = Readonly<{ type: "StartTutorial" }>;
export type DrawAction = Readonly<{ type: "Draw"; turnId: string }>;
export type PlayCardsAction = Readonly<{
  type: "PlayCards";
  turnId: string;
  cardTokens: readonly string[];
  targetId?: string;
  declaredCardType?: CardType;
}>;
export type PlayNopeAction = Readonly<{ type: "PlayNope"; windowId: string; cardToken: string }>;
export type PassResponseAction = Readonly<{ type: "PassResponse"; windowId: string }>;
export type ChooseCardAction = Readonly<{ type: "ChooseCard"; promptId: string; cardToken: string }>;
export type AcknowledgePeekAction = Readonly<{ type: "AcknowledgePeek"; promptId: string }>;
export type UseDefuseAction = Readonly<{ type: "UseDefuse"; promptId: string; cardToken: string }>;
export type InsertKittenAction = Readonly<{ type: "InsertKitten"; promptId: string; position: number }>;
export type ConcedeAction = Readonly<{ type: "Concede" }>;
export type LeaveRoomAction = Readonly<{ type: "LeaveRoom" }>;
export type RestartMatchAction = Readonly<{ type: "RestartMatch" }>;
export type VoteRestartAction = Readonly<{ type: "VoteRestart" }>;
export type UpdateSettingsAction = Readonly<{ type: "UpdateSettings"; sound?: boolean; vibration?: boolean }>;

export type ClientAction =
  | LoginAction
  | CreateRoomAction
  | JoinRoomAction
  | SetReadyAction
  | AddBotAction
  | RemoveBotAction
  | StartMatchAction
  | StartTutorialAction
  | DrawAction
  | PlayCardsAction
  | PlayNopeAction
  | PassResponseAction
  | ChooseCardAction
  | AcknowledgePeekAction
  | UseDefuseAction
  | InsertKittenAction
  | ConcedeAction
  | LeaveRoomAction
  | RestartMatchAction
  | VoteRestartAction
  | UpdateSettingsAction;

export type ClientCommandEnvelope = Readonly<{
  type: "command";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  commandId: string;
  expectedRevision: number;
  action: ClientAction;
}>;

export type ClientResumeEnvelope = Readonly<{
  type: "resume";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  lastRevision: number;
  resumeToken?: string;
}>;

export type ClientEnvelope = ClientCommandEnvelope | ClientResumeEnvelope;

export type MatchSnapshotEnvelope<TSnapshot = unknown> = Readonly<{
  type: "snapshot";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  revision: number;
  snapshot: TSnapshot;
  resumeToken?: string;
}>;

export type CommandAckSuccessEnvelope = Readonly<{
  type: "command.ack";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  commandId: string;
  ok: true;
  revision: number;
}>;

export type CommandAckFailureEnvelope = Readonly<{
  type: "command.ack";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  commandId: string;
  ok: false;
  problem: WireProblem;
}>;

export type CommandAckEnvelope = CommandAckSuccessEnvelope | CommandAckFailureEnvelope;
export type ServerEnvelope<TSnapshot = unknown> = MatchSnapshotEnvelope<TSnapshot> | CommandAckEnvelope;

export interface Codec<T> {
  parse(input: unknown): T;
}

export class ProtocolDecodeError extends Error {
  readonly code = "INVALID_WIRE_MESSAGE";
  readonly path: string;

  constructor(path: string, expectation: string) {
    super(`${path}: expected ${expectation}`);
    this.name = "ProtocolDecodeError";
    this.path = path;
  }
}

type WireRecord = Record<string, unknown>;

function record(input: unknown, path: string): WireRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ProtocolDecodeError(path, "object");
  return input as WireRecord;
}

function exact(value: WireRecord, allowed: readonly string[], path: string): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new ProtocolDecodeError(`${path}.${extra}`, "no additional field");
}

function text(value: unknown, path: string, options: { min?: number; max?: number; pattern?: RegExp } = {}): string {
  if (typeof value !== "string") throw new ProtocolDecodeError(path, "string");
  if (value.length < (options.min ?? 1) || value.length > (options.max ?? 256) || (options.pattern && !options.pattern.test(value))) {
    throw new ProtocolDecodeError(path, "valid string");
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new ProtocolDecodeError(path, "boolean");
  return value;
}

function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new ProtocolDecodeError(path, "safe integer");
  return value as number;
}

function literal<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) throw new ProtocolDecodeError(path, JSON.stringify(expected));
  return expected;
}

function optionalText(value: unknown, path: string, max = 256): string | undefined {
  return value === undefined ? undefined : text(value, path, { max });
}

function list<T>(
  input: unknown,
  path: string,
  parse: (value: unknown, path: string) => T,
  options: { min?: number; max?: number } = {},
): T[] {
  if (!Array.isArray(input)) throw new ProtocolDecodeError(path, "array");
  if (input.length < (options.min ?? 0) || input.length > (options.max ?? 256)) {
    throw new ProtocolDecodeError(path, "bounded array");
  }
  return input.map((value, index) => parse(value, `${path}[${index}]`));
}

function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (!values.includes(value as T)) throw new ProtocolDecodeError(path, values.map((item) => JSON.stringify(item)).join(" or "));
  return value as T;
}

const CARD_TYPES: readonly CardType[] = [
  "EXPLODING_KITTEN", "DEFUSE", "NOPE", "ATTACK", "FAVOR", "SHUFFLE", "SKIP", "SEE_FUTURE",
  "CAT_TACO", "CAT_BEARD", "CAT_POTATO", "CAT_RAINBOW", "CAT_WATERMELON",
];

function parseCardType(value: unknown, path: string): CardType {
  if (!CARD_TYPES.includes(value as CardType)) throw new ProtocolDecodeError(path, "CardType");
  return value as CardType;
}

const SNAPSHOT_PHASES = ["HOME", "LOBBY", "MATCH", "FINISHED"] as const;
const SNAPSHOT_STATUSES = ["ACTIVE", "FINISHED"] as const;
const SNAPSHOT_PENDING_KINDS = [
  "RESPONSE", "EXPLOSION", "DEFUSE_INSERTION", "PRIVATE_PEEK", "GIVE_CARD", "WAITING_PRIVATE_CHOICE",
] as const;
const SNAPSHOT_ACTION_TYPES = [
  "Draw", "PlayCards", "PlayNope", "PassResponse", "ChooseCard", "AcknowledgePeek",
  "UseDefuse", "InsertKitten", "Concede", "Choose",
] as const;

function parsePublicCard(input: unknown, path: string): void {
  const value = record(input, path);
  exact(value, ["type"], path);
  parseCardType(value.type, `${path}.type`);
}

function parseOwnedCard(input: unknown, path: string): void {
  const value = record(input, path);
  exact(value, ["token", "type"], path);
  text(value.token, `${path}.token`);
  parseCardType(value.type, `${path}.type`);
}

function parseSnapshotRoom(input: unknown, path: string): void {
  const value = record(input, path);
  exact(value, ["id", "code", "ownerId", "maxPlayers", "allowBots", "turnSeconds", "rulesetVersion", "tutorial"], path);
  text(value.id, `${path}.id`);
  text(value.code, `${path}.code`, { min: 6, max: 6, pattern: /^\d{6}$/ });
  text(value.ownerId, `${path}.ownerId`);
  const maxPlayers = integer(value.maxPlayers, `${path}.maxPlayers`, 2, 5);
  if (![2, 3, 4, 5].includes(maxPlayers)) throw new ProtocolDecodeError(`${path}.maxPlayers`, "2, 3, 4, or 5");
  bool(value.allowBots, `${path}.allowBots`);
  const turnSeconds = integer(value.turnSeconds, `${path}.turnSeconds`, 30, 60);
  if (![30, 45, 60].includes(turnSeconds)) throw new ProtocolDecodeError(`${path}.turnSeconds`, "30, 45, or 60");
  literal(value.rulesetVersion, "original-2025@1", `${path}.rulesetVersion`);
  bool(value.tutorial, `${path}.tutorial`);
}

function parseSnapshotPlayer(input: unknown, path: string): void {
  const value = record(input, path);
  exact(value, ["id", "name", "avatar", "handCount", "alive", "ready", "bot", "connected"], path);
  text(value.id, `${path}.id`);
  text(value.name, `${path}.name`, { max: 64 });
  optionalText(value.avatar, `${path}.avatar`, 2_048);
  integer(value.handCount, `${path}.handCount`, 0, 56);
  bool(value.alive, `${path}.alive`);
  bool(value.ready, `${path}.ready`);
  bool(value.bot, `${path}.bot`);
  bool(value.connected, `${path}.connected`);
}

function parseSnapshotTurn(input: unknown, path: string): void {
  const value = record(input, path);
  exact(value, ["id", "playerId", "number", "remaining", "direction", "deadlineAt", "deadlineId"], path);
  text(value.id, `${path}.id`);
  text(value.playerId, `${path}.playerId`);
  integer(value.number, `${path}.number`, 1);
  integer(value.remaining, `${path}.remaining`, 1);
  literal(value.direction, "CLOCKWISE", `${path}.direction`);
  integer(value.deadlineAt, `${path}.deadlineAt`);
  text(value.deadlineId, `${path}.deadlineId`);
}

function parseSnapshotPending(input: unknown, path: string): void {
  const value = record(input, path);
  exact(value, [
    "id", "kind", "deadlineAt", "windowId", "promptId", "cards", "actorId", "targetId",
    "declaredCardType", "requesterId", "playerId", "cardTypes", "nopeCount", "viewerPassed",
    "canPass", "deckSize",
  ], path);
  text(value.id, `${path}.id`);
  const kind = oneOf(value.kind, SNAPSHOT_PENDING_KINDS, `${path}.kind`);
  integer(value.deadlineAt, `${path}.deadlineAt`);

  if (kind === "RESPONSE") {
    text(value.windowId, `${path}.windowId`);
    text(value.actorId, `${path}.actorId`);
    optionalText(value.targetId, `${path}.targetId`);
    if (value.declaredCardType !== undefined) parseCardType(value.declaredCardType, `${path}.declaredCardType`);
    list(value.cardTypes, `${path}.cardTypes`, parseCardType, { min: 1, max: 3 });
    integer(value.nopeCount, `${path}.nopeCount`, 0, 5);
    bool(value.viewerPassed, `${path}.viewerPassed`);
    bool(value.canPass, `${path}.canPass`);
    return;
  }

  if (kind === "GIVE_CARD") {
    text(value.promptId, `${path}.promptId`);
    text(value.requesterId, `${path}.requesterId`);
    text(value.playerId, `${path}.playerId`);
    return;
  }

  if (kind === "PRIVATE_PEEK") {
    text(value.promptId, `${path}.promptId`);
    text(value.playerId, `${path}.playerId`);
    list(value.cards, `${path}.cards`, (card, cardPath) => parsePublicCard(card, cardPath), { max: 3 });
    return;
  }

  if (kind === "EXPLOSION") {
    text(value.promptId, `${path}.promptId`);
    text(value.playerId, `${path}.playerId`);
    return;
  }

  if (kind === "DEFUSE_INSERTION") {
    text(value.promptId, `${path}.promptId`);
    text(value.playerId, `${path}.playerId`);
    integer(value.deckSize, `${path}.deckSize`, 0, 56);
    return;
  }

  text(value.playerId, `${path}.playerId`);
  optionalText(value.requesterId, `${path}.requesterId`);
}

function parseSnapshotLegalAction(input: unknown, path: string): void {
  const value = record(input, path);
  exact(value, ["type", "turnId", "windowId", "promptId", "cardTokens"], path);
  oneOf(value.type, SNAPSHOT_ACTION_TYPES, `${path}.type`);
  optionalText(value.turnId, `${path}.turnId`);
  optionalText(value.windowId, `${path}.windowId`);
  optionalText(value.promptId, `${path}.promptId`);
  if (value.cardTokens !== undefined) list(value.cardTokens, `${path}.cardTokens`, (token, tokenPath) => text(token, tokenPath), { max: 56 });
}

function parseSnapshotEvent(input: unknown, path: string): void {
  const value = record(input, path);
  exact(value, ["sequence", "type", "actorId", "cardType", "count", "reason"], path);
  integer(value.sequence, `${path}.sequence`, 1);
  text(value.type, `${path}.type`, { max: 64, pattern: /^[A-Z0-9_]+$/ });
  optionalText(value.actorId, `${path}.actorId`);
  if (value.cardType !== undefined) parseCardType(value.cardType, `${path}.cardType`);
  if (value.count !== undefined) integer(value.count, `${path}.count`, 0, 56);
  optionalText(value.reason, `${path}.reason`, 64);
}

function parseSnapshotRanking(input: unknown, path: string): void {
  const value = record(input, path);
  exact(value, ["playerId", "rank", "reason"], path);
  text(value.playerId, `${path}.playerId`);
  integer(value.rank, `${path}.rank`, 1, 5);
  optionalText(value.reason, `${path}.reason`, 64);
}

/** Strict runtime schema for the authoritative snapshot consumed by the mini-game client. */
export function parseMatchSnapshot(input: unknown): Record<string, unknown> {
  const value = record(input, "$.snapshot");
  exact(value, [
    "phase", "viewerId", "serverTime", "room", "matchId", "status", "winnerId", "you", "players",
    "restartVotes", "deckCount", "discard", "turn", "pending", "privatePeek", "legalActions", "events", "rankings",
  ], "$.snapshot");
  const phase = oneOf(value.phase, SNAPSHOT_PHASES, "$.snapshot.phase");
  const viewerId = text(value.viewerId, "$.snapshot.viewerId");
  integer(value.serverTime, "$.snapshot.serverTime");

  if (phase === "HOME") {
    if (Object.keys(value).some((key) => !["phase", "viewerId", "serverTime"].includes(key))) {
      throw new ProtocolDecodeError("$.snapshot", "HOME snapshot fields only");
    }
    return value;
  }

  parseSnapshotRoom(value.room, "$.snapshot.room");
  const players = list(value.players, "$.snapshot.players", (player, playerPath) => {
    parseSnapshotPlayer(player, playerPath);
    return record(player, playerPath);
  }, { min: 1, max: 5 });
  if (!players.some((player) => player.id === viewerId)) throw new ProtocolDecodeError("$.snapshot.players", "viewer membership");

  if (phase === "LOBBY") {
    if (Object.keys(value).some((key) => !["phase", "viewerId", "serverTime", "room", "players"].includes(key))) {
      throw new ProtocolDecodeError("$.snapshot", "LOBBY snapshot fields only");
    }
    return value;
  }

  text(value.matchId, "$.snapshot.matchId");
  const status = oneOf(value.status, SNAPSHOT_STATUSES, "$.snapshot.status");
  if ((phase === "MATCH") !== (status === "ACTIVE")) throw new ProtocolDecodeError("$.snapshot.status", "status matching phase");
  if (phase === "FINISHED") text(value.winnerId, "$.snapshot.winnerId");
  else if (value.winnerId !== undefined) throw new ProtocolDecodeError("$.snapshot.winnerId", "absent before finish");

  const you = record(value.you, "$.snapshot.you");
  exact(you, ["id", "alive", "hand"], "$.snapshot.you");
  if (text(you.id, "$.snapshot.you.id") !== viewerId) throw new ProtocolDecodeError("$.snapshot.you.id", "viewer id");
  bool(you.alive, "$.snapshot.you.alive");
  list(you.hand, "$.snapshot.you.hand", (card, cardPath) => parseOwnedCard(card, cardPath), { max: 56 });
  list(value.restartVotes, "$.snapshot.restartVotes", (vote, votePath) => text(vote, votePath), { max: 5 });
  integer(value.deckCount, "$.snapshot.deckCount", 0, 56);
  list(value.discard, "$.snapshot.discard", (card, cardPath) => parsePublicCard(card, cardPath), { max: 56 });
  if (value.turn !== null) parseSnapshotTurn(value.turn, "$.snapshot.turn");
  if (value.pending !== null) parseSnapshotPending(value.pending, "$.snapshot.pending");
  list(value.privatePeek, "$.snapshot.privatePeek", (card, cardPath) => parsePublicCard(card, cardPath), { max: 3 });
  list(value.legalActions, "$.snapshot.legalActions", (action, actionPath) => parseSnapshotLegalAction(action, actionPath), { max: 256 });
  list(value.events, "$.snapshot.events", (eventValue, eventPath) => parseSnapshotEvent(eventValue, eventPath), { max: 2_048 });
  if (value.rankings !== undefined) list(value.rankings, "$.snapshot.rankings", (ranking, rankingPath) => parseSnapshotRanking(ranking, rankingPath), { min: 1, max: 5 });
  if (phase === "FINISHED" && value.rankings === undefined) throw new ProtocolDecodeError("$.snapshot.rankings", "finished rankings");
  return value;
}

export const matchSnapshotCodec: Codec<Record<string, unknown>> = { parse: parseMatchSnapshot };

function noPayloadAction(value: WireRecord, type: ClientAction["type"]): ClientAction {
  exact(value, ["type"], "$.action");
  return { type } as ClientAction;
}

export function parseClientAction(input: unknown): ClientAction {
  const value = record(input, "$.action");
  const type = text(value.type, "$.action.type", { max: 32 });
  switch (type) {
    case "Login": {
      exact(value, ["type", "provider", "loginCode", "profile"], "$.action");
      literal(value.provider, "wechat", "$.action.provider");
      const profile = value.profile === undefined ? undefined : record(value.profile, "$.action.profile");
      if (profile) exact(profile, ["displayName", "avatarUrl"], "$.action.profile");
      return {
        type,
        provider: "wechat",
        loginCode: text(value.loginCode, "$.action.loginCode", { max: 256 }),
        ...(profile ? { profile: {
          ...(profile.displayName === undefined ? {} : { displayName: text(profile.displayName, "$.action.profile.displayName", { max: 32 }) }),
          ...(profile.avatarUrl === undefined ? {} : { avatarUrl: text(profile.avatarUrl, "$.action.profile.avatarUrl", { max: 2048 }) }),
        } } : {}),
      };
    }
    case "CreateRoom": {
      exact(value, ["type", "settings"], "$.action");
      const settings = record(value.settings, "$.action.settings");
      exact(settings, ["maxPlayers", "turnSeconds", "responseSeconds", "choiceSeconds", "allowBots", "rulesetVersion"], "$.action.settings");
      const maxPlayers = integer(settings.maxPlayers, "$.action.settings.maxPlayers", 2, 5);
      const turnSeconds = integer(settings.turnSeconds, "$.action.settings.turnSeconds", 30, 60);
      if (![2, 3, 4, 5].includes(maxPlayers) || ![30, 45, 60].includes(turnSeconds)) throw new ProtocolDecodeError("$.action.settings", "supported room settings");
      return { type, settings: {
        maxPlayers: maxPlayers as 2 | 3 | 4 | 5,
        turnSeconds: turnSeconds as 30 | 45 | 60,
        responseSeconds: literal(settings.responseSeconds, 5, "$.action.settings.responseSeconds"),
        choiceSeconds: literal(settings.choiceSeconds, 15, "$.action.settings.choiceSeconds"),
        allowBots: bool(settings.allowBots, "$.action.settings.allowBots"),
        rulesetVersion: literal(settings.rulesetVersion, "original-2025@1", "$.action.settings.rulesetVersion"),
      } };
    }
    case "JoinRoom": exact(value, ["type", "code"], "$.action"); return { type, code: text(value.code, "$.action.code", { min: 6, max: 6, pattern: /^\d{6}$/ }) };
    case "SetReady": exact(value, ["type", "ready"], "$.action"); return { type, ready: bool(value.ready, "$.action.ready") };
    case "RemoveBot": exact(value, ["type", "playerId"], "$.action"); return { type, playerId: text(value.playerId, "$.action.playerId") };
    case "Draw": exact(value, ["type", "turnId"], "$.action"); return { type, turnId: text(value.turnId, "$.action.turnId") };
    case "PlayCards": {
      exact(value, ["type", "turnId", "cardTokens", "targetId", "declaredCardType"], "$.action");
      if (!Array.isArray(value.cardTokens) || value.cardTokens.length < 1 || value.cardTokens.length > 3) throw new ProtocolDecodeError("$.action.cardTokens", "1 to 3 tokens");
      const cardTokens = value.cardTokens.map((token, index) => text(token, `$.action.cardTokens[${index}]`));
      if (new Set(cardTokens).size !== cardTokens.length) throw new ProtocolDecodeError("$.action.cardTokens", "unique tokens");
      return {
        type,
        turnId: text(value.turnId, "$.action.turnId"),
        cardTokens,
        ...(value.targetId === undefined ? {} : { targetId: text(value.targetId, "$.action.targetId") }),
        ...(value.declaredCardType === undefined ? {} : { declaredCardType: parseCardType(value.declaredCardType, "$.action.declaredCardType") }),
      };
    }
    case "PlayNope": exact(value, ["type", "windowId", "cardToken"], "$.action"); return { type, windowId: text(value.windowId, "$.action.windowId"), cardToken: text(value.cardToken, "$.action.cardToken") };
    case "PassResponse": exact(value, ["type", "windowId"], "$.action"); return { type, windowId: text(value.windowId, "$.action.windowId") };
    case "ChooseCard": exact(value, ["type", "promptId", "cardToken"], "$.action"); return { type, promptId: text(value.promptId, "$.action.promptId"), cardToken: text(value.cardToken, "$.action.cardToken") };
    case "AcknowledgePeek": exact(value, ["type", "promptId"], "$.action"); return { type, promptId: text(value.promptId, "$.action.promptId") };
    case "UseDefuse": exact(value, ["type", "promptId", "cardToken"], "$.action"); return { type, promptId: text(value.promptId, "$.action.promptId"), cardToken: text(value.cardToken, "$.action.cardToken") };
    case "InsertKitten": exact(value, ["type", "promptId", "position"], "$.action"); return { type, promptId: text(value.promptId, "$.action.promptId"), position: integer(value.position, "$.action.position", 0, 100) };
    case "UpdateSettings": {
      exact(value, ["type", "sound", "vibration"], "$.action");
      if (value.sound === undefined && value.vibration === undefined) throw new ProtocolDecodeError("$.action", "at least one setting");
      return { type, ...(value.sound === undefined ? {} : { sound: bool(value.sound, "$.action.sound") }), ...(value.vibration === undefined ? {} : { vibration: bool(value.vibration, "$.action.vibration") }) };
    }
    case "AddBot": case "StartMatch": case "StartTutorial": case "Concede": case "LeaveRoom": case "RestartMatch": case "VoteRestart": return noPayloadAction(value, type);
    default: throw new ProtocolDecodeError("$.action.type", "known ClientAction");
  }
}

function parseVersion(value: unknown): typeof PROTOCOL_VERSION {
  return literal(value, PROTOCOL_VERSION, "$.protocolVersion");
}

export function parseClientEnvelope(input: unknown): ClientEnvelope {
  const value = record(input, "$");
  const type = text(value.type, "$.type", { max: 16 });
  if (type === "command") {
    exact(value, ["type", "protocolVersion", "sessionId", "commandId", "expectedRevision", "action"], "$");
    return {
      type,
      protocolVersion: parseVersion(value.protocolVersion),
      sessionId: text(value.sessionId, "$.sessionId"),
      commandId: text(value.commandId, "$.commandId"),
      expectedRevision: integer(value.expectedRevision, "$.expectedRevision"),
      action: parseClientAction(value.action),
    };
  }
  if (type === "resume") {
    exact(value, ["type", "protocolVersion", "sessionId", "lastRevision", "resumeToken"], "$");
    return {
      type,
      protocolVersion: parseVersion(value.protocolVersion),
      sessionId: text(value.sessionId, "$.sessionId"),
      lastRevision: integer(value.lastRevision, "$.lastRevision"),
      ...(value.resumeToken === undefined ? {} : { resumeToken: text(value.resumeToken, "$.resumeToken", { max: 2048 }) }),
    };
  }
  throw new ProtocolDecodeError("$.type", "command or resume");
}

function parseProblem(input: unknown): WireProblem {
  const value = record(input, "$.problem");
  exact(value, ["code", "message", "retryable"], "$.problem");
  return { code: text(value.code, "$.problem.code", { max: 64, pattern: /^[A-Z0-9_]+$/ }), message: text(value.message, "$.problem.message", { max: 512 }), retryable: bool(value.retryable, "$.problem.retryable") };
}

export function parseServerEnvelope<TSnapshot = unknown>(input: unknown, snapshotCodec?: Codec<TSnapshot>): ServerEnvelope<TSnapshot> {
  const value = record(input, "$");
  const type = text(value.type, "$.type", { max: 16 });
  if (type === "snapshot") {
    exact(value, ["type", "protocolVersion", "sessionId", "revision", "snapshot", "resumeToken"], "$");
    return {
      type,
      protocolVersion: parseVersion(value.protocolVersion),
      sessionId: text(value.sessionId, "$.sessionId"),
      revision: integer(value.revision, "$.revision"),
      snapshot: snapshotCodec ? snapshotCodec.parse(value.snapshot) : value.snapshot as TSnapshot,
      ...(value.resumeToken === undefined ? {} : { resumeToken: text(value.resumeToken, "$.resumeToken", { max: 2048 }) }),
    };
  }
  if (type === "command.ack") {
    const ok = bool(value.ok, "$.ok");
    if (ok) {
      exact(value, ["type", "protocolVersion", "sessionId", "commandId", "ok", "revision"], "$");
      return { type, protocolVersion: parseVersion(value.protocolVersion), sessionId: text(value.sessionId, "$.sessionId"), commandId: text(value.commandId, "$.commandId"), ok, revision: integer(value.revision, "$.revision") };
    }
    exact(value, ["type", "protocolVersion", "sessionId", "commandId", "ok", "problem"], "$");
    return { type, protocolVersion: parseVersion(value.protocolVersion), sessionId: text(value.sessionId, "$.sessionId"), commandId: text(value.commandId, "$.commandId"), ok, problem: parseProblem(value.problem) };
  }
  throw new ProtocolDecodeError("$.type", "snapshot or command.ack");
}

export const decodeClientEnvelope = parseClientEnvelope;
export const decodeServerEnvelope = parseServerEnvelope;

export const clientEnvelopeCodec: Codec<ClientEnvelope> = { parse: parseClientEnvelope };
export function serverEnvelopeCodec<TSnapshot = unknown>(snapshotCodec?: Codec<TSnapshot>): Codec<ServerEnvelope<TSnapshot>> {
  return { parse: (input) => parseServerEnvelope(input, snapshotCodec) };
}

export function makeCommandEnvelope(sessionId: string, commandId: string, expectedRevision: number, action: ClientAction): ClientCommandEnvelope {
  return parseClientEnvelope({ type: "command", protocolVersion: PROTOCOL_VERSION, sessionId, commandId, expectedRevision, action }) as ClientCommandEnvelope;
}

export function makeResumeEnvelope(sessionId: string, lastRevision: number, resumeToken?: string): ClientResumeEnvelope {
  return parseClientEnvelope({ type: "resume", protocolVersion: PROTOCOL_VERSION, sessionId, lastRevision, ...(resumeToken ? { resumeToken } : {}) }) as ClientResumeEnvelope;
}
