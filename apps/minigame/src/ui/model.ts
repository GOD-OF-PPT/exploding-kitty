import type { ProductCard, ProductLegalAction, ProductPlayer, RawProductView as SharedRawProductView } from "@exploding-kitty/presentation-model";

export type ScreenId =
  | "login" | "home" | "play-mode" | "create" | "join" | "lobby-host" | "lobby-member"
  | "game" | "other-turn" | "attack" | "response" | "favor" | "give-card" | "future"
  | "explosion" | "defuse" | "eliminated" | "result" | "tutorial" | "rules" | "card-detail"
  | "history" | "game-menu" | "network" | "settings";

export type Tone = "yellow" | "cream" | "cyan" | "red" | "ink";

export type ScreenAction = Readonly<{
  id: string;
  label: string;
  next?: ScreenId;
  intent?: Readonly<{ type: string; [key: string]: unknown }>;
  tone?: Tone;
  /** Navigate back to the prior overlay instead of pushing another history entry. */
  back?: boolean;
}>;

export type ScreenRow = Readonly<{
  id: string;
  title: string;
  detail?: string;
  badge?: string;
  image?: string;
  action?: ScreenAction;
}>;

export type CardModel = ProductCard;
export type LegalActionModel = ProductLegalAction;
export type PlayerModel = ProductPlayer;

export type ScreenModel = Readonly<{
  id: ScreenId;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  heroImage?: string;
  heroLabel?: string;
  rows?: readonly ScreenRow[];
  actions?: readonly ScreenAction[];
  cards?: readonly CardModel[];
  players?: readonly PlayerModel[];
  scroll?: boolean;
  table?: Readonly<{
    turn: number;
    direction: string;
    deckCount: number;
    discard?: CardModel;
    hand: readonly CardModel[];
    players: readonly PlayerModel[];
    myTurn: boolean;
    turnsOwed: number;
  }>;
}>;

export type SessionSnapshot<T> = Readonly<{
  lifecycle: string;
  connectivity: string;
  view: T | null;
  revision?: number;
  pendingCommandId?: string;
  problem?: Readonly<{ code: string; message: string; retryable: boolean }>;
}>;

export interface GameSession<T> {
  getSnapshot(): SessionSnapshot<T>;
  subscribe(listener: () => void): () => void;
  send(action: Readonly<{ type: string; [key: string]: unknown }>): Promise<Readonly<{
    ok: boolean;
    commandId?: string;
    revision?: number;
    code?: string;
    message?: string;
    retryable?: boolean;
  }>>;
  reconnect?(): void;
  dispose(): void;
}

export type RawProductView = SharedRawProductView;
