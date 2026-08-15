import { createHash } from "node:crypto";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Verify both copies independently before asserting that the release is an
 * exact byte-for-byte copy of the source asset.
 */
export function validateAssetIntegrity(file, expectedHash, sourceInput, releaseInput) {
  if (typeof expectedHash !== "string" || !SHA256_PATTERN.test(expectedHash)) {
    throw new Error(`ASSET_SHA256_INVALID:${file}`);
  }

  const source = Buffer.isBuffer(sourceInput) ? sourceInput : Buffer.from(sourceInput);
  const release = Buffer.isBuffer(releaseInput) ? releaseInput : Buffer.from(releaseInput);
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const releaseHash = createHash("sha256").update(release).digest("hex");
  const failures = [];

  if (sourceHash !== expectedHash) failures.push("ASSET_SOURCE_HASH_MISMATCH");
  if (releaseHash !== expectedHash) failures.push("ASSET_RELEASE_HASH_MISMATCH");
  if (!source.equals(release)) failures.push("ASSET_SOURCE_RELEASE_BYTES_MISMATCH");

  if (failures.length > 0) {
    throw new Error(`ASSET_INTEGRITY_FAILED:${file}:${failures.join(",")}`);
  }

  return { bytes: source.length, sha256: sourceHash };
}
