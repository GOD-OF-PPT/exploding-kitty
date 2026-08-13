import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { MysqlGameStore } from "./mysqlStore.js";

describe("MysqlGameStore row decoding", () => {
  it("accepts JSON returned as either strings or parsed values and treats DATETIME as UTC", async () => {
    const state = { status: "ACTIVE", players: [] };
    const tokens = [{ token: "token-1", cardId: "card-1", ownerId: "player-1" }];
    const execute = vi.fn().mockResolvedValue([[
      {
        id: "match-1",
        room_id: "room-1",
        revision: "7",
        state: JSON.stringify(state),
        card_tokens: tokens,
        deadline_id: "deadline-1",
        deadline_at: "2026-08-13 10:20:30.123",
        created_at: "2026-08-13 10:00:00.000",
        updated_at: new Date("2026-08-13T10:10:00.000Z"),
      },
    ], []]);
    const store = new MysqlGameStore({ execute } as unknown as Pool);

    const match = await store.getMatch("match-1");

    expect(match).toMatchObject({ revision: 7, state, tokens });
    expect(match?.deadline?.deadlineAt).toBe(Date.parse("2026-08-13T10:20:30.123Z"));
    expect(execute).toHaveBeenCalledWith("SELECT * FROM matches WHERE id=?", ["match-1"]);
  });

  it("rejects BIGINT revisions that cannot be represented exactly", async () => {
    const execute = vi.fn().mockResolvedValue([[
      {
        id: "match-1",
        room_id: "room-1",
        revision: "9007199254740992",
        state: {},
        card_tokens: [],
        deadline_id: null,
        deadline_at: null,
        created_at: new Date(0),
        updated_at: new Date(0),
      },
    ], []]);
    const store = new MysqlGameStore({ execute } as unknown as Pool);

    await expect(store.getMatch("match-1")).rejects.toThrow("safe integer range");
  });
});
