/**
 * Canonical structural fingerprint of an arbitrary JSON-serializable value.
 *
 * Produces a deterministic string that is independent of object key order, so
 * two actions with the same fields in different insertion order fingerprint
 * identically. Used by {@link MatchCoordinator} and {@link SessionGateway} to
 * detect "same commandId, different payload" replays (COMMAND_ID_REUSED).
 *
 * The output is NOT a cryptographic hash; it is a canonicalized serialization.
 */
export function canonicalFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFingerprint).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalFingerprint(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
