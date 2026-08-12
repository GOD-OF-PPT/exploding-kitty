import {
  RemoteGameSession,
  type RemoteGameSessionOptions,
} from "./remote/RemoteGameSession";

export async function createRemoteSession<TView>(
  options: RemoteGameSessionOptions<TView>,
): Promise<RemoteGameSession<TView>> {
  return RemoteGameSession.open(options);
}
