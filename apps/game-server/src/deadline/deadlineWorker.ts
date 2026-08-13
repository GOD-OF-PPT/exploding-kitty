import type { MatchCoordinator } from "../match/matchCoordinator.js";
import type { Clock } from "../runtime.js";
import type { GameStore } from "../persistence/store.js";

export class DeadlineWorker {
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(
    readonly store: GameStore,
    readonly matches: MatchCoordinator,
    readonly clock: Clock,
    readonly intervalMs = 1_000,
    readonly batchSize = 20,
    readonly onProcessed?: (matchId: string) => Promise<void>,
  ) {}

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => { void this.tick().catch(() => undefined); }, this.intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async tick(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const due = await this.store.claimDueDeadlines(this.clock.now(), this.batchSize);
      for (const deadline of due) {
        try {
          await this.matches.executeDeadline(deadline.matchId, deadline.deadlineId, deadline.deadlineAt);
          await this.onProcessed?.(deadline.matchId);
        } finally {
          await this.store.releaseDeadline(deadline);
        }
      }
    } finally {
      this.#running = false;
    }
  }
}
