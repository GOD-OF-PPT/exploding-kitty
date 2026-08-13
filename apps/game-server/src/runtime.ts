import { randomBytes, randomInt, randomUUID } from "node:crypto";

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface RoomCodeGenerator {
  next(): string;
}

export const systemClock: Clock = { now: () => Date.now() };

export const secureIds: IdGenerator = {
  next: (prefix) => `${prefix}_${randomUUID()}`,
};

export const secureRoomCodes: RoomCodeGenerator = {
  next: () => randomInt(0, 1_000_000).toString().padStart(6, "0"),
};

export function secureSeed(): Uint8Array {
  return randomBytes(32);
}
