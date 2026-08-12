export function seedFrom(value: number | string | undefined): number {
  if (typeof value === "number") return (value >>> 0) || 0x9e3779b9;
  const text = value ?? "exploding-kitty";
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 0x9e3779b9;
}

export function nextRandom(state: number): [number, number] {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return [next / 0x100000000, next || 0x9e3779b9];
}

export function shuffle<T>(items: readonly T[], state: number): [T[], number] {
  const result = [...items];
  let rngState = state;
  for (let index = result.length - 1; index > 0; index -= 1) {
    let random: number;
    [random, rngState] = nextRandom(rngState);
    const target = Math.floor(random * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return [result, rngState];
}
