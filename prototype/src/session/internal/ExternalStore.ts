export class ExternalStore<TSnapshot> {
  readonly #listeners = new Set<() => void>();
  #snapshot: TSnapshot;
  #disposed = false;

  constructor(initialSnapshot: TSnapshot) {
    this.#snapshot = initialSnapshot;
  }

  readonly getSnapshot = (): TSnapshot => this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  set(nextSnapshot: TSnapshot): void {
    if (this.#disposed || Object.is(this.#snapshot, nextSnapshot)) return;
    this.#snapshot = nextSnapshot;
    for (const listener of [...this.#listeners]) listener();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }
}
