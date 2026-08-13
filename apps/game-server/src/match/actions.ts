import type { CardType } from "@exploding-kitty/game-core";

/** Wire-safe match intentions. Identity, time, random outcomes and deadlines are intentionally absent. */
export type MatchAction =
  | Readonly<{ type: "Draw"; turnId: string }>
  | Readonly<{ type: "PlayCards"; turnId: string; cardTokens: readonly string[]; targetId?: string; declaredCardType?: CardType }>
  | Readonly<{ type: "PlayNope"; windowId: string; cardToken: string }>
  | Readonly<{ type: "PassResponse"; windowId: string }>
  | Readonly<{ type: "ChooseCard"; promptId: string; cardToken: string }>
  | Readonly<{ type: "AcknowledgePeek"; promptId: string }>
  | Readonly<{ type: "UseDefuse"; promptId: string; cardToken: string }>
  | Readonly<{ type: "InsertKitten"; promptId: string; position: number }>
  | Readonly<{ type: "Concede" }>;

export type MatchCommandEnvelope = Readonly<{
  sessionId: string;
  commandId: string;
  expectedRevision: number;
  action: MatchAction;
}>;
