import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { PROTOCOL_VERSION, type ClientAction, type ServerEnvelope } from "@exploding-kitty/protocol";
import { buildApp } from "./app.js";
import { AuthService, DisabledWechatProvider } from "./auth/authService.js";
import { DeadlineWorker } from "./deadline/deadlineWorker.js";
import { MatchCoordinator } from "./match/matchCoordinator.js";
import type { MatchSnapshot } from "./model.js";
import { MemoryGameStore } from "./persistence/memoryStore.js";
import { RoomCoordinator } from "./room/roomCoordinator.js";
import { ConnectionHub } from "./transport/connectionHub.js";
import { SessionGateway } from "./transport/sessionGateway.js";

type Wire = ServerEnvelope<MatchSnapshot>;
let wireCommandId = 0;

class WireClient {
  revision = 0;
  snapshot: MatchSnapshot | null = null;
  readonly messages: Wire[] = [];
  #waiters: Array<() => void> = [];

  constructor(readonly socket: WebSocket, readonly sessionId: string) {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Wire;
      this.messages.push(message);
      if (message.type === "snapshot" && message.sessionId === sessionId && message.revision >= this.revision) {
        this.revision = message.revision;
        this.snapshot = message.snapshot;
      }
      for (const wake of this.#waiters.splice(0)) wake();
    });
  }

  resume(): void {
    this.socket.send(JSON.stringify({ type: "resume", protocolVersion: PROTOCOL_VERSION, sessionId: this.sessionId, lastRevision: this.revision }));
  }

  async command(action: ClientAction) {
    const commandId = `${this.sessionId}-${++wireCommandId}`;
    this.socket.send(JSON.stringify({ type: "command", protocolVersion: PROTOCOL_VERSION, sessionId: this.sessionId, commandId, expectedRevision: this.revision, action }));
    return this.waitFor((message) => message.type === "command.ack" && message.commandId === commandId);
  }

  async waitSnapshot(predicate: (snapshot: MatchSnapshot) => boolean): Promise<MatchSnapshot> {
    if (this.snapshot && predicate(this.snapshot)) return this.snapshot;
    await this.waitFor((message) => message.type === "snapshot" && predicate(message.snapshot));
    return this.snapshot!;
  }

  async waitFor(predicate: (message: Wire) => boolean): Promise<Wire> {
    const existing = this.messages.find(predicate);
    if (existing) return existing;
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WSS_SMOKE_TIMEOUT")), Math.max(1, deadline - Date.now()));
        this.#waiters.push(() => { clearTimeout(timer); resolve(); });
      });
      const found = this.messages.find(predicate);
      if (found) return found;
    }
    throw new Error("WSS_SMOKE_TIMEOUT");
  }
}

describe("real Fastify WebSocket flow", () => {
  it("runs two authenticated clients through room, match, reconnect, result, vote, restart and leave", async () => {
    let now = 10_000;
    let id = 0;
    const clock = { now: () => now };
    const ids = { next: (prefix: string) => `${prefix}-${++id}` };
    const store = new MemoryGameStore();
    const auth = new AuthService("test-auth-secret-that-is-at-least-32-chars", new DisabledWechatProvider(), clock.now);
    const rooms = new RoomCoordinator({ store, clock, ids, seed: () => new Uint8Array(32).fill(1) });
    const matches = new MatchCoordinator({ store, clock, token: ids });
    const hub = new ConnectionHub();
    const gateway = new SessionGateway({ rooms, matches, store, hub });
    const app = await buildApp({ auth, rooms, store, gateway, hub, devAuthEnabled: true, wechatTrustCloudHeaders: false });
    const deadlines = new DeadlineWorker(store, matches, clock, 1, 20, (matchId) => gateway.broadcast(matchId));
    await app.ready();

    const issue = async (developmentIdentity: string, displayName: string) => {
      const response = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity, profile: { displayName } } });
      expect(response.statusCode).toBe(200);
      return response.json<{ token: string; playerId: string }>();
    };
    const aliceIdentity = await issue("00112233445566778899aabbccddeeff", "Alice");
    const bobIdentity = await issue("ffeeddccbbaa99887766554433221100", "Bob");
    const aliceSocket = await openSessionSocket(app, aliceIdentity.token);
    const bobSocket = await openSessionSocket(app, bobIdentity.token);
    const alice = new WireClient(aliceSocket, `wx-${aliceIdentity.playerId}`);
    const bob = new WireClient(bobSocket, `wx-${bobIdentity.playerId}`);

    alice.resume(); bob.resume();
    await Promise.all([alice.waitSnapshot((value) => value.phase === "HOME"), bob.waitSnapshot((value) => value.phase === "HOME")]);
    const settings = { maxPlayers: 2, turnSeconds: 30, responseSeconds: 5, choiceSeconds: 15, allowBots: false, rulesetVersion: "original-2025@1" } as const;
    expect(await alice.command({ type: "CreateRoom", settings })).toMatchObject({ type: "command.ack", ok: true });
    const code = (await alice.waitSnapshot((value) => value.phase === "LOBBY")).room!.code;
    expect(await bob.command({ type: "JoinRoom", code })).toMatchObject({ type: "command.ack", ok: true });
    expect(await bob.command({ type: "SetReady", ready: true })).toMatchObject({ type: "command.ack", ok: true });
    await alice.waitSnapshot((value) => value.players?.length === 2 && value.players.every((player) => player.ready) || false);
    expect(await alice.command({ type: "StartMatch" })).toMatchObject({ type: "command.ack", ok: true });
    await Promise.all([alice.waitSnapshot((value) => value.phase === "MATCH"), bob.waitSnapshot((value) => value.phase === "MATCH")]);

    // Close and recreate Bob's real socket, proving a full private snapshot can be resumed.
    bobSocket.close(1000, "smoke reconnect");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const bobSocket2 = await openSessionSocket(app, bobIdentity.token);
    const bob2 = new WireClient(bobSocket2, bob.sessionId);
    bob2.revision = bob.revision;
    bob2.resume();
    const restored = await bob2.waitSnapshot((value) => value.phase === "MATCH");
    expect(restored.you?.id).toBe(bobIdentity.playerId);
    expect(restored.you?.hand).toHaveLength(8);
    expect(restored.players?.find((player) => player.id === aliceIdentity.playerId)).not.toHaveProperty("hand");

    // The seed guarantees Alice can play a single action and Bob holds a Nope.
    const actor = alice.snapshot?.turn?.playerId === aliceIdentity.playerId ? alice : bob2;
    const responder = actor === alice ? bob2 : alice;
    const playable = actor.snapshot?.legalActions?.find((action) => action.type === "PlayCards" && action.cardTokens?.length === 1);
    expect(playable?.cardTokens?.[0]).toBeTruthy();
    expect(await actor.command({ type: "PlayCards", turnId: playable!.turnId!, cardTokens: [playable!.cardTokens![0]!] })).toMatchObject({ type: "command.ack", ok: true });
    const response = await responder.waitSnapshot((value) => value.pending?.kind === "RESPONSE");
    expect(response.pending).toMatchObject({ actorId: actor.snapshot?.viewerId });
    const nope = response.legalActions?.find((action) => action.type === "PlayNope" && action.cardTokens?.[0]);
    expect(nope?.cardTokens?.[0]).toBeTruthy();
    expect(await responder.command({ type: "PlayNope", windowId: nope!.windowId!, cardToken: nope!.cardTokens![0]! })).toMatchObject({ type: "command.ack", ok: true });
    const afterNope = await actor.waitSnapshot((value) => value.pending?.kind === "RESPONSE" && value.pending.nopeCount === 1);
    for (const client of [actor, responder]) {
      const pass = (client === actor ? afterNope : await client.waitSnapshot((value) => value.pending?.kind === "RESPONSE" && value.pending.nopeCount === 1))
        .legalActions?.find((action) => action.type === "PassResponse");
      if (pass?.windowId) expect(await client.command({ type: "PassResponse", windowId: pass.windowId })).toMatchObject({ type: "command.ack", ok: true });
    }

    expect(await bob2.command({ type: "Concede" })).toMatchObject({ type: "command.ack", ok: true });
    const result = await alice.waitSnapshot((value) => value.phase === "FINISHED");
    expect(result.winnerId).toBe(aliceIdentity.playerId);
    expect(await bob2.command({ type: "VoteRestart" })).toMatchObject({ type: "command.ack", ok: true });
    await alice.waitSnapshot((value) => value.restartVotes?.includes(bobIdentity.playerId) || false);
    expect(await alice.command({ type: "RestartMatch" })).toMatchObject({ type: "command.ack", ok: true });
    await bob2.waitSnapshot((value) => value.phase === "MATCH" && value.you?.alive === true);
    expect(await bob2.command({ type: "Concede" })).toMatchObject({ type: "command.ack", ok: true });
    await alice.waitSnapshot((value) => value.phase === "FINISHED");
    expect(await bob2.command({ type: "LeaveRoom" })).toMatchObject({ type: "command.ack", ok: true });
    expect((await bob2.waitSnapshot((value) => value.phase === "HOME")).room).toBeUndefined();

    aliceSocket.close(); bobSocket2.close();
    deadlines.stop();
    await app.close();
  });

  it("exposes Favor, private peek and Defuse insertion only through authoritative WSS projections", async () => {
    let now = 20_000;
    let id = 0;
    const clock = { now: () => now };
    const ids = { next: (prefix: string) => `${prefix}-private-${++id}` };
    const store = new MemoryGameStore();
    const auth = new AuthService("private-flow-auth-secret-at-least-32-chars", new DisabledWechatProvider(), clock.now);
    const seed = new Uint8Array(32); seed[0] = 169 & 255; seed[1] = 169 >> 8;
    const rooms = new RoomCoordinator({ store, clock, ids, seed: () => seed });
    const matches = new MatchCoordinator({ store, clock, token: ids });
    const hub = new ConnectionHub();
    const gateway = new SessionGateway({ rooms, matches, store, hub });
    const app = await buildApp({ auth, rooms, store, gateway, hub, devAuthEnabled: true, wechatTrustCloudHeaders: false });
    await app.ready();
    const issue = async (identity: string) => (await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { developmentIdentity: identity } })).json<{ token: string; playerId: string }>();
    const aliceIdentity = await issue("10000000000000000000000000000001");
    const bobIdentity = await issue("20000000000000000000000000000002");
    const aliceSocket = await openSessionSocket(app, aliceIdentity.token);
    const bobSocket = await openSessionSocket(app, bobIdentity.token);
    const alice = new WireClient(aliceSocket, `wx-${aliceIdentity.playerId}`);
    const bob = new WireClient(bobSocket, `wx-${bobIdentity.playerId}`);
    alice.resume(); bob.resume();
    await Promise.all([alice.waitSnapshot((value) => value.phase === "HOME"), bob.waitSnapshot((value) => value.phase === "HOME")]);
    const settings = { maxPlayers: 2, turnSeconds: 30, responseSeconds: 5, choiceSeconds: 15, allowBots: false, rulesetVersion: "original-2025@1" } as const;
    await alice.command({ type: "CreateRoom", settings });
    const code = (await alice.waitSnapshot((value) => value.phase === "LOBBY")).room!.code;
    await bob.command({ type: "JoinRoom", code });
    await bob.command({ type: "SetReady", ready: true });
    await alice.waitSnapshot((value) => value.players?.every((player) => player.ready) || false);
    await alice.command({ type: "StartMatch" });
    await Promise.all([alice.waitSnapshot((value) => value.phase === "MATCH"), bob.waitSnapshot((value) => value.phase === "MATCH")]);

    const resolveResponse = async (actor: WireClient, other: WireClient): Promise<void> => {
      const window = await actor.waitSnapshot((value) => value.pending?.kind === "RESPONSE");
      for (const client of [actor, other]) {
        const view = client === actor ? window : await client.waitSnapshot((value) => value.pending?.kind === "RESPONSE");
        const pass = view.legalActions?.find((action) => action.type === "PassResponse");
        if (pass?.windowId) expect(await client.command({ type: "PassResponse", windowId: pass.windowId })).toMatchObject({ type: "command.ack", ok: true });
      }
    };

    const favor = alice.snapshot!.legalActions!.find((action) => action.type === "PlayCards" && action.cardTokens?.length === 1
      && alice.snapshot!.you!.hand.find((card) => card.token === action.cardTokens![0])?.type === "FAVOR")!;
    expect(await alice.command({ type: "PlayCards", turnId: favor.turnId!, cardTokens: favor.cardTokens!, targetId: bobIdentity.playerId })).toMatchObject({ ok: true });
    await resolveResponse(alice, bob);
    const choice = await bob.waitSnapshot((value) => value.pending?.kind === "GIVE_CARD");
    expect(alice.snapshot?.pending?.kind).not.toBe("GIVE_CARD");
    const give = choice.legalActions?.find((action) => action.type === "ChooseCard" && action.cardTokens?.[0])!;
    expect(await bob.command({ type: "ChooseCard", promptId: give.promptId!, cardToken: give.cardTokens![0]! })).toMatchObject({ ok: true });

    const peek = alice.snapshot!.legalActions!.find((action) => action.type === "PlayCards" && action.cardTokens?.length === 1
      && alice.snapshot!.you!.hand.find((card) => card.token === action.cardTokens![0])?.type === "SEE_FUTURE")!;
    expect(await alice.command({ type: "PlayCards", turnId: peek.turnId!, cardTokens: peek.cardTokens! })).toMatchObject({ ok: true });
    await resolveResponse(alice, bob);
    const privatePeek = await alice.waitSnapshot((value) => value.pending?.kind === "PRIVATE_PEEK");
    expect(privatePeek.privatePeek?.length).toBeGreaterThan(0);
    expect(bob.snapshot?.privatePeek).toEqual([]);
    const acknowledge = privatePeek.legalActions?.find((action) => action.type === "AcknowledgePeek")!;
    expect(await alice.command({ type: "AcknowledgePeek", promptId: acknowledge.promptId! })).toMatchObject({ ok: true });

    // The chosen deterministic deck starts with an exploding kitten after the two action cards remain discarded.
    const current = await store.getRoomForPlayer(aliceIdentity.playerId);
    const match = await store.getMatch(current!.matchId!);
    const forced = structuredClone(match!);
    const kittenIndex = forced.state.deck.findIndex((card) => card.type === "EXPLODING_KITTEN");
    const [kitten] = forced.state.deck.splice(kittenIndex, 1);
    forced.state.deck.unshift(kitten!);
    await store.transactMatch(forced.id, async (transaction) => { await transaction.saveMatch(forced); });
    const turn = (await matches.resume({ playerId: aliceIdentity.playerId, sessionToken: "internal" }, current!.id)).snapshot.turn!;
    expect(await alice.command({ type: "Draw", turnId: turn.id })).toMatchObject({ ok: true });
    const explosion = await alice.waitSnapshot((value) => value.pending?.kind === "EXPLOSION");
    const defuse = explosion.legalActions?.find((action) => action.type === "UseDefuse" && action.cardTokens?.[0])!;
    expect(await alice.command({ type: "UseDefuse", promptId: defuse.promptId!, cardToken: defuse.cardTokens![0]! })).toMatchObject({ ok: true });
    const insertion = await alice.waitSnapshot((value) => value.pending?.kind === "DEFUSE_INSERTION");
    expect(bob.snapshot?.pending?.kind).toBe("WAITING_PRIVATE_CHOICE");
    const insert = insertion.legalActions?.find((action) => action.type === "InsertKitten")!;
    expect(await alice.command({ type: "InsertKitten", promptId: insert.promptId!, position: insertion.pending!.deckSize! })).toMatchObject({ ok: true });
    expect(alice.snapshot?.pending).toBeNull();

    aliceSocket.close(); bobSocket.close();
    await app.close();
  });
});

function openSessionSocket(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
): Promise<WebSocket> {
  return app.injectWS("/v1/session", { headers: { authorization: `Bearer ${token}` } });
}
