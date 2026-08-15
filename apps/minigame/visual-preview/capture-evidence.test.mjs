import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertExplicitEmptyOutputDirectory,
  cropRgbaImage,
  encodeRgbaPng,
  publishEvidenceBatch,
} from "./capture-evidence.mjs";
import { decodePng } from "./verify-evidence.mjs";

test("encodes an exact RGBA crop as a verifier-readable PNG", () => {
  const source = {
    width: 3,
    height: 2,
    rgba: Buffer.from([
      1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255,
      10, 11, 12, 255, 13, 14, 15, 255, 16, 17, 18, 255,
    ]),
  };
  const cropped = cropRgbaImage(source, { x: 1, y: 0, width: 2, height: 2 });
  const decoded = decodePng(encodeRgbaPng(cropped), "derived-focus.png");
  assert.deepEqual({ width: decoded.width, height: decoded.height }, { width: 2, height: 2 });
  assert.deepEqual([...decoded.rgba], [
    4, 5, 6, 255, 7, 8, 9, 255,
    13, 14, 15, 255, 16, 17, 18, 255,
  ]);
});

test("requires an explicit output outside protected repository paths and leaves it empty", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ek-capture-output-"));
  const repositoryRoot = resolve(root, "repository");
  const canonical = resolve(repositoryRoot, "apps/minigame/visual-preview/evidence");
  const external = resolve(root, "external-evidence");
  try {
    await mkdir(canonical, { recursive: true });
    await mkdir(external);
    await assert.doesNotReject(() => assertExplicitEmptyOutputDirectory(canonical, repositoryRoot));
    await assert.doesNotReject(() => assertExplicitEmptyOutputDirectory(external, repositoryRoot));
    await writeFile(resolve(external, "stale.txt"), "stale");
    await assert.rejects(
      () => assertExplicitEmptyOutputDirectory(external, repositoryRoot),
      /EVIDENCE_OUTPUT_NOT_EMPTY/u,
    );
    const protectedPath = resolve(repositoryRoot, "apps/minigame/assets/new-evidence");
    await mkdir(protectedPath, { recursive: true });
    await assert.rejects(
      () => assertExplicitEmptyOutputDirectory(protectedPath, repositoryRoot),
      /EVIDENCE_OUTPUT_INSIDE_REPOSITORY_FORBIDDEN/u,
    );
    const repositoryAlias = resolve(root, "repository-alias");
    try {
      await symlink(repositoryRoot, repositoryAlias, process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(
        () => assertExplicitEmptyOutputDirectory(
          resolve(repositoryAlias, "apps/minigame/assets/new-evidence"),
          repositoryRoot,
        ),
        /EVIDENCE_OUTPUT_INSIDE_REPOSITORY_FORBIDDEN/u,
      );
    } catch (error) {
      if (!new Set(["EPERM", "EACCES", "ENOTSUP"]).has(error?.code)) throw error;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes a verified staging batch atomically", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ek-capture-publish-"));
  const staging = resolve(root, ".evidence-stage");
  const output = resolve(root, "evidence");
  try {
    await mkdir(staging);
    await mkdir(output);
    await writeFile(resolve(staging, "manifest.json"), "verified");
    const verified = [];
    await publishEvidenceBatch({
      stagingDirectory: staging,
      outputDirectory: output,
      verify: async (directory) => {
        verified.push(directory);
        assert.equal(await readFile(resolve(directory, "manifest.json"), "utf8"), "verified");
      },
    });
    assert.deepEqual(verified, [staging, output]);
    assert.equal(await readFile(resolve(output, "manifest.json"), "utf8"), "verified");
    await assert.rejects(() => stat(staging), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not replace the empty target when staging verification fails", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ek-capture-failure-"));
  const staging = resolve(root, ".evidence-stage");
  const output = resolve(root, "evidence");
  try {
    await mkdir(staging);
    await mkdir(output);
    await writeFile(resolve(staging, "partial.png"), "partial");
    await assert.rejects(
      () => publishEvidenceBatch({
        stagingDirectory: staging,
        outputDirectory: output,
        verify: async () => { throw new Error("STRICT_VERIFY_RED"); },
      }),
      /STRICT_VERIFY_RED/u,
    );
    assert.deepEqual(await readFile(resolve(staging, "partial.png"), "utf8"), "partial");
    assert.deepEqual(await (await import("node:fs/promises")).readdir(output), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves a file that appears in the target before publication", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ek-capture-race-"));
  const staging = resolve(root, ".evidence-stage");
  const output = resolve(root, "evidence");
  try {
    await mkdir(staging);
    await mkdir(output);
    await writeFile(resolve(staging, "manifest.json"), "complete");
    let calls = 0;
    await assert.rejects(
      () => publishEvidenceBatch({
        stagingDirectory: staging,
        outputDirectory: output,
        verify: async () => {
          calls += 1;
          if (calls === 1) await writeFile(resolve(output, "intruder.txt"), "must survive");
        },
      }),
      /EVIDENCE_OUTPUT_NOT_EMPTY/u,
    );
    assert.equal(await readFile(resolve(output, "intruder.txt"), "utf8"), "must survive");
    assert.equal(await readFile(resolve(staging, "manifest.json"), "utf8"), "complete");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rolls a published batch back to staging if the post-rename verifier fails", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ek-capture-rollback-"));
  const staging = resolve(root, ".evidence-stage");
  const output = resolve(root, "evidence");
  try {
    await mkdir(staging);
    await mkdir(output);
    await writeFile(resolve(staging, "manifest.json"), "complete");
    let calls = 0;
    await assert.rejects(
      () => publishEvidenceBatch({
        stagingDirectory: staging,
        outputDirectory: output,
        verify: async () => {
          calls += 1;
          if (calls === 2) throw new Error("POST_RENAME_VERIFY_RED");
        },
      }),
      /POST_RENAME_VERIFY_RED/u,
    );
    assert.equal(await readFile(resolve(staging, "manifest.json"), "utf8"), "complete");
    assert.deepEqual(await (await import("node:fs/promises")).readdir(output), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
