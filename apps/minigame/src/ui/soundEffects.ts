import type { PublicEvent } from "@exploding-kitty/presentation-model";
import type { WxMediaAdapter } from "../platform";

export const SOUND_ASSETS = {
  select: "assets/sounds/select.wav",
  action: "assets/sounds/action.wav",
  nope: "assets/sounds/nope.wav",
  danger: "assets/sounds/danger.wav",
} as const;

export type AuthoritySoundView = Readonly<{
  matchId: string;
  connectivity: string;
  events: readonly PublicEvent[];
}>;

/** Consumes only live, monotonically newer public events from one match. */
export class AuthoritativeSoundPlayer {
  private matchId = "";
  private connectivity = "";
  private sequence = 0;

  constructor(private readonly media: Pick<WxMediaAdapter, "play">) {}

  prime(view: AuthoritySoundView): void {
    this.matchId = view.matchId;
    this.connectivity = view.connectivity.toLowerCase();
    this.sequence = latestSequence(view.events);
  }

  consume(view: AuthoritySoundView): void {
    const connectivity = view.connectivity.toLowerCase();
    const wasLive = isLive(this.connectivity);
    const isSameMatch = view.matchId === this.matchId;
    if (!wasLive || !isLive(connectivity) || !isSameMatch) {
      this.prime(view);
      return;
    }

    const fresh = view.events
      .filter((event) => event.sequence > this.sequence)
      .sort((left, right) => left.sequence - right.sequence);
    for (const event of fresh) this.playEvent(event);
    this.matchId = view.matchId;
    this.connectivity = connectivity;
    this.sequence = Math.max(this.sequence, latestSequence(view.events));
  }

  private playEvent(event: PublicEvent): void {
    if (event.type === "NOPE_PLAYED") this.media.play("nope", SOUND_ASSETS.nope, 0.72);
    else if (event.type === "EXPLODING_KITTEN_REVEALED") this.media.play("danger", SOUND_ASSETS.danger, 0.88);
    else if (event.type === "CARDS_COMMITTED" || event.type === "CARD_DRAWN") this.media.play("action", SOUND_ASSETS.action, 0.62);
  }
}

function latestSequence(events: readonly PublicEvent[]): number {
  return events.reduce((latest, event) => Math.max(latest, event.sequence), 0);
}

function isLive(connectivity: string): boolean {
  return connectivity === "online" || connectivity === "local";
}
