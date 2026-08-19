import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nextRandom, seedFrom, shuffle } from "./random.js";
import type { DeterministicRandomState } from "./types.js";

function sha256Digest(input: number[]): number[] {
  return Array.from(createHash("sha256").update(Buffer.from(input)).digest());
}

/** Bytes that seedFrom prepends before hashing the seed material. */
const SEED_HASH_PREFIX = [0x6b, 0x65, 0x79, 0]; // "key\0"
const SEED_NONCE_PREFIX = [0x6e, 0x6f, 0x6e, 0x63, 0x65, 0]; // "nonce\0"

function utf8Bytes(text: string): number[] {
  return Array.from(Buffer.from(text, "utf8"));
}

describe("SHA-256 regression vectors", () => {
  it("matches Node crypto for a short single-block input (NIST CAVP short vector)", () => {
    const seed = "abc";
    const seedBytes = utf8Bytes(seed);

    const expectedDigest = sha256Digest([...SEED_HASH_PREFIX, ...seedBytes]);
    const expectedNonceDigest = sha256Digest([...SEED_NONCE_PREFIX, ...seedBytes]).slice(0, 12);

    const state = seedFrom(seed);
    expect(state.key).toEqual(expectedDigest);
    expect(state.nonce).toEqual(expectedNonceDigest);
  });

  it("matches Node crypto for an empty input", () => {
    const seed = "";
    const seedBytes = utf8Bytes(seed);

    const expectedDigest = sha256Digest([...SEED_HASH_PREFIX, ...seedBytes]);
    expect(seedFrom(seed).key).toEqual(expectedDigest);
  });

  it("matches Node crypto for a multi-block input spanning two 64-byte blocks", () => {
    const seed = "a".repeat(100); // 100 bytes + 4-byte prefix = 104 bytes → 2 blocks
    const seedBytes = utf8Bytes(seed);

    const expectedDigest = sha256Digest([...SEED_HASH_PREFIX, ...seedBytes]);
    const expectedNonceDigest = sha256Digest([...SEED_NONCE_PREFIX, ...seedBytes]).slice(0, 12);

    const state = seedFrom(seed);
    expect(state.key).toEqual(expectedDigest);
    expect(state.nonce).toEqual(expectedNonceDigest);
  });
});

describe("ChaCha20 RFC 8439 block vector", () => {
  it("produces a keystream that matches Node crypto for the RFC 8439 test vector", () => {
    const cipherKey = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
    const cipherNonce = Buffer.from("000000000000004a00000000", "hex");

    // Node.js chacha20 IV = 4-byte counter (LE) + 12-byte nonce
    const iv = Buffer.concat([Buffer.from([0x01, 0x00, 0x00, 0x00]), cipherNonce]);
    const cipher = createCipheriv("chacha20", cipherKey, iv);
    const zeroBlock = Buffer.alloc(64);
    const expectedKeystream = Array.from(Buffer.concat([cipher.update(zeroBlock), cipher.final()]));

    const keyArr = Array.from(cipherKey);
    const nonceArr = Array.from(cipherNonce);
    const state: DeterministicRandomState = {
      key: keyArr,
      nonce: nonceArr,
      counter: 1,
      buffer: [],
      offset: 0,
    };

    const [, blockState] = nextRandom(state);
    expect(blockState.buffer).toEqual(expectedKeystream);
  });

  it("encrypts the RFC 8439 Section 2.3.2 plaintext to match Node crypto ciphertext", () => {
    // RFC 8439 Section 2.3.2 encryption test vector
    const cipherKey = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
    const cipherNonce = Buffer.from("000000000000004a00000000", "hex");
    const plaintext = Buffer.from(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
    );

    // Reference ciphertext from Node's chacha20
    const iv = Buffer.concat([Buffer.from([0x01, 0x00, 0x00, 0x00]), cipherNonce]);
    const cipher = createCipheriv("chacha20", cipherKey, iv);
    const expectedCiphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    // Generate keystream from the implementation and XOR with plaintext
    const keyArr = Array.from(cipherKey);
    const nonceArr = Array.from(cipherNonce);
    let s: DeterministicRandomState = { key: keyArr, nonce: nonceArr, counter: 1, buffer: [], offset: 0 };
    const keystreamBytes: number[] = [];
    let remaining = plaintext.length;
    while (remaining > 0) {
      const [, next] = nextRandom(s);
      const take = Math.min(64, remaining);
      keystreamBytes.push(...next.buffer.slice(0, take));
      remaining -= take;
      s = { key: keyArr, nonce: nonceArr, counter: next.counter, buffer: next.buffer, offset: 64 };
    }
    const keystream = Buffer.from(keystreamBytes.slice(0, plaintext.length));
    const ciphertext = Buffer.alloc(plaintext.length);
    for (let i = 0; i < plaintext.length; i++) ciphertext[i] = plaintext[i]! ^ keystream[i]!;

    expect(ciphertext).toEqual(expectedCiphertext);
  });

  it("advances the counter and regenerates the buffer on exhaustion", () => {
    const state = seedFrom("chacha-counter-test");
    const [v1, s1] = nextRandom(state);
    expect(v1).toBeGreaterThanOrEqual(0);
    expect(v1).toBeLessThan(1);
    expect(s1.counter).toBe(1);
    expect(s1.buffer.length).toBe(64);
    expect(s1.offset).toBe(4);

    // Drain the remaining 15 words (60 bytes) to exhaust the buffer
    let s = s1;
    for (let i = 0; i < 15; i++) {
      const [, next] = nextRandom(s);
      s = next;
    }
    expect(s.offset).toBe(64);

    // Next call should generate a fresh block with counter 2
    const [, s2] = nextRandom(s);
    expect(s2.counter).toBe(2);
    expect(s2.buffer.length).toBe(64);
    expect(s2.offset).toBe(4);
  });
});

describe("shuffle determinism", () => {
  it("produces a stable permutation for the same seed state", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const state = seedFrom("shuffle-seed");
    const [a] = shuffle(items, state);
    const [b] = shuffle(items, state);
    expect(a).toEqual(b);
  });

  it("preserves all elements after shuffling", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const state = seedFrom("preserve-seed");
    const [shuffled] = shuffle(items, state);
    expect(shuffled.sort((a, b) => a - b)).toEqual(items);
  });
});
