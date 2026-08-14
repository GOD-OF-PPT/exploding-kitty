import type { Card, CardType } from "./types.js";

export const CARD_COUNTS: Readonly<Record<CardType, number>> = {
  EXPLODING_KITTEN: 4,
  DEFUSE: 6,
  NOPE: 5,
  ATTACK: 4,
  FAVOR: 4,
  SHUFFLE: 4,
  SKIP: 4,
  SEE_FUTURE: 5,
  CAT_TACO: 4,
  CAT_BEARD: 4,
  CAT_POTATO: 4,
  CAT_RAINBOW: 4,
  CAT_WATERMELON: 4,
};

export function createFullDeck(): Card[] {
  return Object.entries(CARD_COUNTS).flatMap(([type, count]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${type.toLowerCase()}-${index + 1}`,
      type: type as CardType,
    })),
  );
}
