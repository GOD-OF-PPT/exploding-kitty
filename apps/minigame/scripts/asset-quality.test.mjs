import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { validateAssetIntegrity } from "./asset-integrity.mjs";
import { inspectRaster, validateRasterContract } from "./asset-quality.mjs";

test("rejects a raster that cannot supply its declared CSS size at the target DPR", () => {
  const manifest = manifestWith({
    "ui/backgrounds/comic.png": rasterSpec({
      role: "background",
      intrinsic: { width: 390, height: 844 },
      maxCssSize: { width: 390, height: 844 },
      targetDpr: 3,
      fit: "cover",
      edgePolicy: "bleed",
    }),
  });

  assert.throws(
    () => validateRasterContract(manifest, new Map([
      ["ui/backgrounds/comic.png", rasterInspection(390, 844)],
    ])),
    /ASSET_RASTER_DENSITY_INSUFFICIENT:ui\/backgrounds\/comic\.png:390x844:1170x2532/,
  );
});

test("rejects an undeclared cover crop larger than the manifest allowance", () => {
  const manifest = manifestWith({
    "ui/backgrounds/comic.png": rasterSpec({
      role: "background",
      intrinsic: { width: 1400, height: 2532 },
      maxCssSize: { width: 390, height: 844 },
      targetDpr: 3,
      fit: "cover",
      maxCropRatio: 0.05,
      edgePolicy: "bleed",
    }),
  });

  assert.throws(
    () => validateRasterContract(manifest, new Map([
      ["ui/backgrounds/comic.png", rasterInspection(1400, 2532)],
    ])),
    /ASSET_RASTER_CROP_EXCEEDS_LIMIT:ui\/backgrounds\/comic\.png/,
  );
});

test("requires every full-card asset to share one production aspect ratio", () => {
  const manifest = manifestWith({
    "cards/attack.png": rasterSpec({
      role: "full-card",
      intrinsic: { width: 840, height: 1200 },
      maxCssSize: { width: 210, height: 300 },
      targetDpr: 3,
      fit: "contain",
      edgePolicy: "framed",
    }),
    "cards/skip.png": rasterSpec({
      role: "full-card",
      intrinsic: { width: 720, height: 1200 },
      maxCssSize: { width: 210, height: 300 },
      targetDpr: 3,
      fit: "contain",
      edgePolicy: "framed",
    }),
  });

  assert.throws(
    () => validateRasterContract(manifest, new Map([
      ["cards/attack.png", rasterInspection(840, 1200)],
      ["cards/skip.png", rasterInspection(720, 1200)],
    ])),
    /ASSET_FULL_CARD_ASPECT_MISMATCH:cards\/skip\.png/,
  );
});

test("rejects hard-cut and detached edge content for non-bleed transparent art", () => {
  const manifest = manifestWith({
    "cats/player.png": rasterSpec({
      role: "avatar",
      intrinsic: { width: 900, height: 900 },
      maxCssSize: { width: 285, height: 285 },
      targetDpr: 3,
      fit: "contain",
      edgePolicy: "transparent-safe",
    }),
  });

  assert.throws(
    () => validateRasterContract(manifest, new Map([
      ["cats/player.png", rasterInspection(900, 900, {
        alpha: {
          present: true,
          minimum: 0,
          maximum: 255,
          transparentPixelRatio: 0.25,
          edgeOccupancy: { top: 0, right: 0, bottom: 0.09, left: 0 },
          detachedEdgeComponents: 0,
        },
      })],
    ])),
    /ASSET_RASTER_EDGE_HARD_CUT:cats\/player\.png:bottom/,
  );

  assert.throws(
    () => validateRasterContract(manifest, new Map([
      ["cats/player.png", rasterInspection(900, 900, {
        alpha: {
          present: true,
          minimum: 0,
          maximum: 255,
          transparentPixelRatio: 0.25,
          edgeOccupancy: { top: 0, right: 0, bottom: 0, left: 0 },
          detachedEdgeComponents: 1,
        },
      })],
    ])),
    /ASSET_RASTER_NEIGHBOR_FRAGMENT:cats\/player\.png:1/,
  );
});

test("decodes PNG alpha and detects a detached edge fragment", () => {
  const png = makeRgbaPng(10, 10, (x, y) => {
    const mainSubject = x >= 3 && x <= 6 && y >= 3 && y <= 6;
    const edgeFragment = x <= 1 && y >= 4 && y <= 5;
    return mainSubject || edgeFragment ? [255, 80, 40, 255] : [0, 0, 0, 0];
  });

  assert.deepEqual(inspectRaster(png, "avatar.png"), {
    format: "png",
    width: 10,
    height: 10,
    alpha: {
      present: true,
      minimum: 0,
      maximum: 255,
      transparentPixelRatio: 0.8,
      edgeOccupancy: { top: 0, right: 0, bottom: 0, left: 0.2 },
      detachedEdgeComponents: 1,
    },
  });
});

test("rejects near-opaque alpha left behind by strip extraction", () => {
  const manifest = manifestWith({
    "cards/attack.png": rasterSpec({
      role: "full-card",
      intrinsic: { width: 840, height: 1200 },
      maxCssSize: { width: 210, height: 300 },
      targetDpr: 3,
      fit: "contain",
      edgePolicy: "framed",
    }),
  });

  assert.throws(
    () => validateRasterContract(manifest, new Map([
      ["cards/attack.png", rasterInspection(840, 1200, {
        alpha: {
          present: true,
          minimum: 233,
          maximum: 255,
          transparentPixelRatio: 0,
          edgeOccupancy: { top: 1, right: 1, bottom: 1, left: 1 },
          detachedEdgeComponents: 0,
        },
      })],
    ])),
    /ASSET_RASTER_ALPHA_NEAR_OPAQUE:cards\/attack\.png:233/,
  );
});

test("requires complete raster declarations and role-safe fit policies", () => {
  assert.throws(
    () => validateRasterContract({
      files: ["cards/attack.png"],
      rasterContractVersion: 1,
      raster: {},
    }, new Map()),
    /ASSET_RASTER_SPEC_MISSING:cards\/attack\.png/,
  );

  const spec = rasterSpec({
    role: "full-card",
    intrinsic: { width: 840, height: 1200 },
    maxCssSize: { width: 280, height: 400 },
    targetDpr: 3,
    fit: "cover",
    maxCropRatio: 0,
    edgePolicy: "framed",
  });
  assert.throws(
    () => validateRasterContract(manifestWith({ "cards/attack.png": spec }), new Map([
      ["cards/attack.png", rasterInspection(840, 1200)],
    ])),
    /ASSET_RASTER_ROLE_POLICY_INVALID:cards\/attack\.png:full-card/,
  );
});

test("does not let critical assets under-declare their real production slot", () => {
  const spec = rasterSpec({
    role: "full-card",
    intrinsic: { width: 840, height: 1200 },
    maxCssSize: { width: 1, height: 1 },
    targetDpr: 3,
    fit: "contain",
    maxCropRatio: 0,
    edgePolicy: "framed",
  });
  assert.throws(
    () => validateRasterContract(manifestWith({ "cards/attack.png": spec }), new Map([
      ["cards/attack.png", rasterInspection(840, 1200)],
    ])),
    /ASSET_RASTER_PRODUCTION_SLOT_UNDERDECLARED:cards\/attack\.png:1x1:210x300/,
  );
});

test("requires source and release assets to independently match the manifest hash", () => {
  const expected = Buffer.from("canonical asset bytes");
  const expectedHash = createHash("sha256").update(expected).digest("hex");

  assert.deepEqual(validateAssetIntegrity("cards/attack.png", expectedHash, expected, expected), {
    bytes: expected.length,
    sha256: expectedHash,
  });

  assert.throws(
    () => validateAssetIntegrity(
      "cards/attack.png",
      expectedHash,
      Buffer.from("corrupt source bytes"),
      expected,
    ),
    /ASSET_INTEGRITY_FAILED:cards\/attack\.png:ASSET_SOURCE_HASH_MISMATCH,ASSET_SOURCE_RELEASE_BYTES_MISMATCH/,
  );

  assert.throws(
    () => validateAssetIntegrity(
      "cards/attack.png",
      expectedHash,
      expected,
      Buffer.from("stale release bytes"),
    ),
    /ASSET_INTEGRITY_FAILED:cards\/attack\.png:ASSET_RELEASE_HASH_MISMATCH,ASSET_SOURCE_RELEASE_BYTES_MISMATCH/,
  );
});

test("does not let matching source and release corruption bypass the manifest hash", () => {
  const expected = Buffer.from("canonical asset bytes");
  const corrupted = Buffer.from("matching corruption");
  const expectedHash = createHash("sha256").update(expected).digest("hex");

  assert.throws(
    () => validateAssetIntegrity("cards/attack.png", expectedHash, corrupted, corrupted),
    /ASSET_INTEGRITY_FAILED:cards\/attack\.png:ASSET_SOURCE_HASH_MISMATCH,ASSET_RELEASE_HASH_MISMATCH$/,
  );
});

test("requires a canonical lowercase SHA-256 for every release asset", () => {
  const bytes = Buffer.from("asset");
  assert.throws(
    () => validateAssetIntegrity("cards/attack.png", undefined, bytes, bytes),
    /ASSET_SHA256_INVALID:cards\/attack\.png/,
  );
  assert.throws(
    () => validateAssetIntegrity("cards/attack.png", "A".repeat(64), bytes, bytes),
    /ASSET_SHA256_INVALID:cards\/attack\.png/,
  );
});

test("binds known large hero slots to their actual production draw size and DPR", () => {
  const avatar = rasterSpec({
    role: "avatar",
    intrinsic: { width: 900, height: 900 },
    maxCssSize: { width: 215, height: 215 },
    targetDpr: 3,
    fit: "contain",
    maxCropRatio: 0,
    edgePolicy: "transparent-safe",
  });
  assert.throws(
    () => validateRasterContract(manifestWith({ "cats/player.png": avatar }), new Map([
      ["cats/player.png", rasterInspection(900, 900)],
    ])),
    /ASSET_RASTER_PRODUCTION_SLOT_UNDERDECLARED:cats\/player\.png:215x215:285x285/,
  );

  const networkIcon = rasterSpec({
    intrinsic: { width: 320, height: 320 },
    maxCssSize: { width: 106, height: 106 },
    targetDpr: 2,
  });
  assert.throws(
    () => validateRasterContract(manifestWith({
      "ui/icons/cream/device-mobile-hero.png": networkIcon,
    }), new Map([
      ["ui/icons/cream/device-mobile-hero.png", rasterInspection(320, 320)],
    ])),
    /ASSET_RASTER_PRODUCTION_DPR_UNDERDECLARED:ui\/icons\/cream\/device-mobile-hero\.png:2:3/,
  );

  const onlineNetworkIcon = rasterSpec({
    intrinsic: { width: 320, height: 320 },
    maxCssSize: { width: 27, height: 27 },
    targetDpr: 3,
  });
  assert.throws(
    () => validateRasterContract(manifestWith({
      "ui/icons/cream/check-hero.png": onlineNetworkIcon,
    }), new Map([
      ["ui/icons/cream/check-hero.png", rasterInspection(320, 320)],
    ])),
    /ASSET_RASTER_PRODUCTION_SLOT_UNDERDECLARED:ui\/icons\/cream\/check-hero\.png:27x27:106x106/,
  );

  const toolbarIcon = rasterSpec();
  assert.doesNotThrow(
    () => validateRasterContract(manifestWith({
      "ui/icons/cream/device-mobile.png": toolbarIcon,
    }), new Map([
      ["ui/icons/cream/device-mobile.png", rasterInspection(64, 64)],
    ])),
  );
});

test("keeps the raster contract closed over the release file list", () => {
  const icon = rasterSpec();
  const manifest = manifestWith({
    "ui/icons/ink/check.png": icon,
    "ui/icons/ink/obsolete.png": icon,
  });
  manifest.files = ["ui/icons/ink/check.png"];

  assert.throws(
    () => validateRasterContract(manifest, new Map([
      ["ui/icons/ink/check.png", rasterInspection(64, 64)],
    ])),
    /ASSET_RASTER_SPEC_FOREIGN:ui\/icons\/ink\/obsolete\.png/,
  );
});

function manifestWith(raster) {
  return {
    files: Object.keys(raster),
    rasterContractVersion: 1,
    raster,
  };
}

function rasterSpec(overrides = {}) {
  return {
    role: "icon",
    intrinsic: { width: 64, height: 64 },
    maxCssSize: { width: 27, height: 27 },
    targetDpr: 2,
    fit: "contain",
    maxCropRatio: 0,
    edgePolicy: "transparent-safe",
    ...overrides,
  };
}

function rasterInspection(width, height, overrides = {}) {
  return {
    format: "png",
    width,
    height,
    alpha: {
      present: true,
      minimum: 0,
      maximum: 255,
      transparentPixelRatio: 0.25,
      edgeOccupancy: { top: 0, right: 0, bottom: 0, left: 0 },
      detachedEdgeComponents: 0,
    },
    ...overrides,
  };
}

function makeRgbaPng(width, height, pixelAt) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      scanlines.set(pixelAt(x, y), offset);
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
