import { describe, expect, it, vi } from "vitest";
import { AuthoritativeSoundPlayer, SOUND_ASSETS } from "./soundEffects";

describe("authoritative sound player", () => {
  it("does not replay the initial snapshot and consumes each new sequence once", () => {
    const play = vi.fn();
    const sounds = new AuthoritativeSoundPlayer({ play });
    sounds.prime(view("online", [{ sequence: 1, type: "CARD_DRAWN" }]));
    expect(play).not.toHaveBeenCalled();

    const update = view("online", [
      { sequence: 1, type: "CARD_DRAWN" },
      { sequence: 2, type: "CARDS_COMMITTED" },
      { sequence: 3, type: "NOPE_PLAYED" },
      { sequence: 4, type: "EXPLODING_KITTEN_REVEALED" },
    ]);
    sounds.consume(update);
    sounds.consume(update);

    expect(play.mock.calls).toEqual([
      ["action", SOUND_ASSETS.action, 0.62],
      ["nope", SOUND_ASSETS.nope, 0.72],
      ["danger", SOUND_ASSETS.danger, 0.88],
    ]);
  });

  it("establishes a new watermark after reconnect instead of replaying missed history", () => {
    const play = vi.fn();
    const sounds = new AuthoritativeSoundPlayer({ play });
    sounds.prime(view("online", [{ sequence: 1, type: "MATCH_STARTED" }]));
    sounds.consume(view("offline", [{ sequence: 1, type: "MATCH_STARTED" }]));
    sounds.consume(view("online", [{ sequence: 1, type: "MATCH_STARTED" }, { sequence: 2, type: "CARD_DRAWN" }]));
    expect(play).not.toHaveBeenCalled();
  });
});

function view(connectivity: string, events: { sequence: number; type: string }[]) {
  return { matchId: "match-1", connectivity, events };
}
