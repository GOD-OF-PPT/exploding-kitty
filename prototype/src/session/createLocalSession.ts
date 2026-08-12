import {
  LocalGameSession,
  type LocalGameSessionOptions,
} from "./local/LocalGameSession";

/**
 * Composition-root factory. The injected kernel adapter must implement
 * create, restore, execute, project and serialize; it may optionally dispose.
 */
export async function createLocalSession<TState, TView>(
  options: LocalGameSessionOptions<TState, TView>,
): Promise<LocalGameSession<TState, TView>> {
  return LocalGameSession.open(options);
}
