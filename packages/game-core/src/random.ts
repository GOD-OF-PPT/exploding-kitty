import type { DeterministicRandomState } from "./types.js";

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const rotateRight = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));

function utf8(text: string): number[] {
  const encoded = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return bytes;
}

function sha256(input: readonly number[]): number[] {
  const bytes = [...input];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const hash: number[] = [...SHA256_INITIAL];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = (
        ((bytes[start] ?? 0) << 24)
        | ((bytes[start + 1] ?? 0) << 16)
        | ((bytes[start + 2] ?? 0) << 8)
        | (bytes[start + 3] ?? 0)
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15] ?? 0;
      const b = words[index - 2] ?? 0;
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      words[index] = ((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0;
    }
    let [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const choice = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + sum1 + choice + (SHA256_K[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }
  return hash.flatMap((word) => [word >>> 24, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff]);
}

function littleEndianWord(bytes: readonly number[], offset: number): number {
  return (
    (bytes[offset] ?? 0)
    | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16)
    | ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function quarterRound(words: number[], a: number, b: number, c: number, d: number): void {
  words[a] = ((words[a] ?? 0) + (words[b] ?? 0)) >>> 0;
  words[d] = rotateRight((words[d] ?? 0) ^ (words[a] ?? 0), 16) >>> 0;
  words[c] = ((words[c] ?? 0) + (words[d] ?? 0)) >>> 0;
  words[b] = rotateRight((words[b] ?? 0) ^ (words[c] ?? 0), 20) >>> 0;
  words[a] = ((words[a] ?? 0) + (words[b] ?? 0)) >>> 0;
  words[d] = rotateRight((words[d] ?? 0) ^ (words[a] ?? 0), 24) >>> 0;
  words[c] = ((words[c] ?? 0) + (words[d] ?? 0)) >>> 0;
  words[b] = rotateRight((words[b] ?? 0) ^ (words[c] ?? 0), 25) >>> 0;
}

function chacha20Block(key: readonly number[], nonce: readonly number[], counter: number): number[] {
  const initial = [
    0x61707865, 0x3320646e, 0x79622d32, 0x6b206574,
    ...Array.from({ length: 8 }, (_, index) => littleEndianWord(key, index * 4)),
    counter >>> 0,
    ...Array.from({ length: 3 }, (_, index) => littleEndianWord(nonce, index * 4)),
  ];
  const words = [...initial];
  for (let round = 0; round < 10; round += 1) {
    quarterRound(words, 0, 4, 8, 12); quarterRound(words, 1, 5, 9, 13);
    quarterRound(words, 2, 6, 10, 14); quarterRound(words, 3, 7, 11, 15);
    quarterRound(words, 0, 5, 10, 15); quarterRound(words, 1, 6, 11, 12);
    quarterRound(words, 2, 7, 8, 13); quarterRound(words, 3, 4, 9, 14);
  }
  return words.flatMap((word, index) => {
    const value = (word + (initial[index] ?? 0)) >>> 0;
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24];
  });
}

function seedBytes(value: number | string | Uint8Array | undefined): number[] {
  if (value instanceof Uint8Array) return [...value];
  return utf8(String(value ?? "exploding-kitty"));
}

export function seedFrom(value: number | string | Uint8Array | undefined): DeterministicRandomState {
  const seed = seedBytes(value);
  return {
    key: sha256([0x6b, 0x65, 0x79, 0, ...seed]),
    nonce: sha256([0x6e, 0x6f, 0x6e, 0x63, 0x65, 0, ...seed]).slice(0, 12),
    counter: 0,
    buffer: [],
    offset: 0,
  };
}

export function nextRandom(state: DeterministicRandomState): [number, DeterministicRandomState] {
  let buffer = state.buffer;
  let offset = state.offset;
  let counter = state.counter;
  if (offset + 4 > buffer.length) {
    buffer = chacha20Block(state.key, state.nonce, counter);
    offset = 0;
    counter = (counter + 1) >>> 0;
  }
  const value = littleEndianWord(buffer, offset) / 0x100000000;
  return [value, { ...state, counter, buffer, offset: offset + 4 }];
}

export function shuffle<T>(items: readonly T[], state: DeterministicRandomState): [T[], DeterministicRandomState] {
  const result = [...items];
  let rngState = state;
  for (let index = result.length - 1; index > 0; index -= 1) {
    let random: number;
    [random, rngState] = nextRandom(rngState);
    const target = Math.floor(random * (index + 1));
    const held = result[index];
    result[index] = result[target] as T;
    result[target] = held as T;
  }
  return [result, rngState];
}
