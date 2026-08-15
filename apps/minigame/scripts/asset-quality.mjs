import { inflateSync } from "node:zlib";

const RASTER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ROLES = new Set(["background", "full-card", "avatar", "hero", "icon"]);
const FITS = new Set(["contain", "cover"]);
const EDGE_POLICIES = new Set(["bleed", "framed", "transparent-safe"]);
const PNG_SIGNATURE = "89504e470d0a1a0a";
const MAX_RASTER_PIXELS = 12_000_000;

export function inspectRaster(input, file = "<asset>") {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.subarray(0, 8).toString("hex") === PNG_SIGNATURE) return inspectPng(bytes, file);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes, file);
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return inspectWebp(bytes, file);
  }
  throw new Error(`ASSET_RASTER_FORMAT_UNSUPPORTED:${file}`);
}

/**
 * Validate the declared raster interface against decoded source inspections.
 * The caller owns file IO; tests and build tooling cross the same seam.
 */
export function validateRasterContract(manifest, inspections) {
  if (manifest?.rasterContractVersion !== 1) {
    throw new Error("ASSET_RASTER_CONTRACT_VERSION_UNSUPPORTED");
  }
  if (!manifest.raster || typeof manifest.raster !== "object" || Array.isArray(manifest.raster)) {
    throw new Error("ASSET_RASTER_CONTRACT_MISSING");
  }
  if (!(inspections instanceof Map)) throw new Error("ASSET_RASTER_INSPECTIONS_INVALID");
  if (!Array.isArray(manifest.files)) throw new Error("ASSET_RELEASE_FILE_LIST_INVALID");
  const releaseFiles = new Set(manifest.files);
  if (releaseFiles.size !== manifest.files.length) throw new Error("ASSET_RELEASE_FILE_LIST_DUPLICATE");
  const releaseRasters = new Set(manifest.files.filter(isRasterFile));
  for (const file of Object.keys(manifest.raster)) {
    if (!releaseRasters.has(file)) throw new Error(`ASSET_RASTER_SPEC_FOREIGN:${file}`);
  }

  let canonicalCard;
  for (const file of manifest.files) {
    if (!isRasterFile(file)) continue;
    const spec = manifest.raster[file];
    if (!spec) throw new Error(`ASSET_RASTER_SPEC_MISSING:${file}`);
    validateRasterSpec(file, spec);
    const inspection = inspections.get(file);
    if (!inspection) throw new Error(`ASSET_RASTER_INSPECTION_MISSING:${file}`);
    validateIntrinsic(file, spec.intrinsic, inspection);
    validateNativeDensity(file, spec, inspection);
    validateCropAllowance(file, spec, inspection);
    validateEdges(file, spec, inspection);
    if (spec.role === "full-card") {
      if (!canonicalCard) canonicalCard = { file, ...inspection };
      else if (inspection.width * canonicalCard.height !== canonicalCard.width * inspection.height) {
        throw new Error(
          `ASSET_FULL_CARD_ASPECT_MISMATCH:${file}:${inspection.width}x${inspection.height}:${canonicalCard.file}:${canonicalCard.width}x${canonicalCard.height}`,
        );
      }
    }
  }
}

function validateEdges(file, spec, inspection) {
  if (spec.edgePolicy === "bleed") return;
  const alpha = inspection.alpha;
  if (spec.edgePolicy === "transparent-safe" && !alpha?.present) {
    throw new Error(`ASSET_RASTER_TRANSPARENCY_REQUIRED:${file}`);
  }
  if (!alpha?.present) return;
  if (!Number.isFinite(alpha.minimum) || !Number.isFinite(alpha.transparentPixelRatio)) {
    throw new Error(`ASSET_RASTER_EDGE_INSPECTION_UNAVAILABLE:${file}:${inspection.format}`);
  }
  if (alpha.minimum >= 192 && alpha.minimum < 255) {
    throw new Error(`ASSET_RASTER_ALPHA_NEAR_OPAQUE:${file}:${alpha.minimum}`);
  }
  if (alpha.detachedEdgeComponents > 0) {
    throw new Error(`ASSET_RASTER_NEIGHBOR_FRAGMENT:${file}:${alpha.detachedEdgeComponents}`);
  }
  if (spec.edgePolicy === "transparent-safe" && alpha.transparentPixelRatio < 0.01) {
    throw new Error(`ASSET_RASTER_TRANSPARENT_MARGIN_MISSING:${file}`);
  }
  if (alpha.transparentPixelRatio < 0.01) return;
  for (const side of ["top", "right", "bottom", "left"]) {
    const occupancy = alpha.edgeOccupancy?.[side];
    if (!Number.isFinite(occupancy)) throw new Error(`ASSET_RASTER_EDGE_INSPECTION_INVALID:${file}:${side}`);
    if (occupancy > 0.05) {
      throw new Error(`ASSET_RASTER_EDGE_HARD_CUT:${file}:${side}:${occupancy.toFixed(6)}`);
    }
  }
}

export function coverCropRatio(source, target) {
  validateSize(source, "ASSET_RASTER_CROP_SOURCE_SIZE_INVALID");
  validateSize(target, "ASSET_RASTER_CROP_TARGET_SIZE_INVALID");
  const sourceAspect = source.width / source.height;
  const targetAspect = target.width / target.height;
  return 1 - Math.min(sourceAspect, targetAspect) / Math.max(sourceAspect, targetAspect);
}

function validateRasterSpec(file, spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`ASSET_RASTER_SPEC_INVALID:${file}`);
  }
  if (!ROLES.has(spec.role)) throw new Error(`ASSET_RASTER_ROLE_INVALID:${file}`);
  if (!FITS.has(spec.fit)) throw new Error(`ASSET_RASTER_FIT_INVALID:${file}`);
  if (!EDGE_POLICIES.has(spec.edgePolicy)) throw new Error(`ASSET_RASTER_EDGE_POLICY_INVALID:${file}`);
  validateSize(spec.intrinsic, `ASSET_RASTER_INTRINSIC_INVALID:${file}`);
  validateSize(spec.maxCssSize, `ASSET_RASTER_MAX_CSS_SIZE_INVALID:${file}`);
  if (![1, 2, 3].includes(spec.targetDpr)) throw new Error(`ASSET_RASTER_TARGET_DPR_INVALID:${file}`);
  if (!Number.isFinite(spec.maxCropRatio) || spec.maxCropRatio < 0 || spec.maxCropRatio > 0.15) {
    throw new Error(`ASSET_RASTER_MAX_CROP_RATIO_INVALID:${file}`);
  }
  const rolePolicyValid = (
    (spec.role === "background" && spec.fit === "cover" && spec.edgePolicy === "bleed" && spec.targetDpr === 3)
    || (spec.role === "full-card" && spec.fit === "contain" && spec.edgePolicy === "framed" && spec.targetDpr === 3 && spec.maxCropRatio === 0)
    || (spec.role === "avatar" && spec.fit === "contain" && spec.edgePolicy === "transparent-safe" && spec.targetDpr === 3 && spec.maxCropRatio === 0)
    || (spec.role === "hero" && spec.fit === "contain" && spec.edgePolicy === "transparent-safe" && spec.targetDpr === 3 && spec.maxCropRatio === 0)
    || (spec.role === "icon" && spec.fit === "contain" && spec.edgePolicy === "transparent-safe" && spec.targetDpr >= 2 && spec.maxCropRatio === 0)
  );
  if (!rolePolicyValid) throw new Error(`ASSET_RASTER_ROLE_POLICY_INVALID:${file}:${spec.role}`);
  const minimumSlot = minimumProductionSlot(file, spec.role);
  if (spec.maxCssSize.width < minimumSlot.width || spec.maxCssSize.height < minimumSlot.height) {
    throw new Error(
      `ASSET_RASTER_PRODUCTION_SLOT_UNDERDECLARED:${file}:${spec.maxCssSize.width}x${spec.maxCssSize.height}:${minimumSlot.width}x${minimumSlot.height}`,
    );
  }
  const minimumDpr = minimumProductionDpr(file, spec.role);
  if (spec.targetDpr < minimumDpr) {
    throw new Error(`ASSET_RASTER_PRODUCTION_DPR_UNDERDECLARED:${file}:${spec.targetDpr}:${minimumDpr}`);
  }
}

function minimumProductionSlot(file, role) {
  if (role === "background") return { width: 390, height: 844 };
  if (file === "cards/danger.png") return { width: 218, height: 311 };
  if (role === "full-card") return { width: 210, height: 300 };
  if (role === "avatar") return { width: 285, height: 285 };
  if (
    file === "ui/icons/cream/device-mobile-hero.png"
    || file === "ui/icons/cream/check-hero.png"
  ) return { width: 106, height: 106 };
  if (role === "icon") return { width: 27, height: 27 };
  if (file === "cat-cast.png") return { width: 390, height: 122 };
  return { width: 215, height: 215 };
}

function minimumProductionDpr(file, role) {
  if (
    file === "ui/icons/cream/device-mobile-hero.png"
    || file === "ui/icons/cream/check-hero.png"
  ) return 3;
  return role === "icon" ? 2 : 3;
}

function validateIntrinsic(file, expected, actual) {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `ASSET_RASTER_INTRINSIC_MISMATCH:${file}:${actual.width}x${actual.height}:${expected.width}x${expected.height}`,
    );
  }
}

function validateNativeDensity(file, spec, actual) {
  const requiredWidth = Math.ceil(spec.maxCssSize.width * spec.targetDpr);
  const requiredHeight = Math.ceil(spec.maxCssSize.height * spec.targetDpr);
  if (actual.width < requiredWidth || actual.height < requiredHeight) {
    throw new Error(
      `ASSET_RASTER_DENSITY_INSUFFICIENT:${file}:${actual.width}x${actual.height}:${requiredWidth}x${requiredHeight}`,
    );
  }
}

function validateCropAllowance(file, spec, actual) {
  const cropRatio = spec.fit === "cover" ? coverCropRatio(actual, spec.maxCssSize) : 0;
  if (cropRatio > spec.maxCropRatio + 1e-9) {
    throw new Error(
      `ASSET_RASTER_CROP_EXCEEDS_LIMIT:${file}:${cropRatio.toFixed(6)}:${spec.maxCropRatio.toFixed(6)}`,
    );
  }
}

function validateSize(value, code) {
  if (
    !value
    || typeof value !== "object"
    || !Number.isInteger(value.width)
    || value.width <= 0
    || !Number.isInteger(value.height)
    || value.height <= 0
  ) throw new Error(code);
}

function isRasterFile(file) {
  if (typeof file !== "string") return false;
  const dot = file.lastIndexOf(".");
  return dot >= 0 && RASTER_EXTENSIONS.has(file.slice(dot).toLowerCase());
}

function inspectPng(bytes, file) {
  let offset = 8;
  let header;
  let palette;
  let transparency;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const dataOffset = offset + 8;
    const end = dataOffset + length;
    if (end + 4 > bytes.length) throw new Error(`ASSET_PNG_CHUNK_TRUNCATED:${file}`);
    const type = bytes.subarray(offset + 4, dataOffset).toString("ascii");
    const data = bytes.subarray(dataOffset, end);
    if (type === "IHDR") {
      if (length !== 13 || header) throw new Error(`ASSET_PNG_IHDR_INVALID:${file}`);
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") transparency = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    offset = end + 4;
  }
  if (!header || idat.length === 0) throw new Error(`ASSET_PNG_STRUCTURE_INVALID:${file}`);
  validateDecodedDimensions(header.width, header.height, file);
  if (
    header.bitDepth !== 8
    || ![0, 2, 3, 4, 6].includes(header.colorType)
    || header.compression !== 0
    || header.filter !== 0
    || header.interlace !== 0
  ) throw new Error(`ASSET_PNG_ENCODING_UNSUPPORTED:${file}`);
  const channels = pngChannels(header.colorType);
  const rowBytes = header.width * channels;
  const expectedLength = (rowBytes + 1) * header.height;
  let filtered;
  try {
    filtered = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedLength });
  } catch {
    throw new Error(`ASSET_PNG_DEFLATE_INVALID:${file}`);
  }
  if (filtered.length !== expectedLength) throw new Error(`ASSET_PNG_SCANLINE_LENGTH_INVALID:${file}`);
  const samples = unfilterPng(filtered, header.width, header.height, channels, file);
  const alpha = pngAlpha(samples, header, palette, transparency, file);
  return {
    format: "png",
    width: header.width,
    height: header.height,
    alpha: analyzeAlpha(alpha, header.width, header.height),
  };
}

function inspectJpeg(bytes, file) {
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      validateDecodedDimensions(width, height, file);
      return { format: "jpeg", width, height, alpha: { present: false } };
    }
    offset += length;
  }
  throw new Error(`ASSET_JPEG_DIMENSIONS_MISSING:${file}`);
}

function inspectWebp(bytes, file) {
  const chunk = bytes.subarray(12, 16).toString("ascii");
  let width;
  let height;
  if (chunk === "VP8X" && bytes.length >= 30) {
    width = 1 + bytes.readUIntLE(24, 3);
    height = 1 + bytes.readUIntLE(27, 3);
  } else if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  }
  if (!width || !height) throw new Error(`ASSET_WEBP_DIMENSIONS_MISSING:${file}`);
  validateDecodedDimensions(width, height, file);
  return { format: "webp", width, height, alpha: { present: chunk === "VP8X" && Boolean(bytes[20] & 0x10) } };
}

function validateDecodedDimensions(width, height, file) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_RASTER_PIXELS) {
    throw new Error(`ASSET_RASTER_DIMENSIONS_UNSAFE:${file}:${width}x${height}`);
  }
}

function unfilterPng(filtered, width, height, bytesPerPixel, file) {
  const rowBytes = width * bytesPerPixel;
  const output = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++];
    if (filter > 4) throw new Error(`ASSET_PNG_FILTER_UNSUPPORTED:${file}:${filter}`);
    const rowOffset = y * rowBytes;
    const previousOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= bytesPerPixel ? output[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? output[previousOffset + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? output[previousOffset + x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      output[rowOffset + x] = (raw + predictor) & 0xff;
    }
    sourceOffset += rowBytes;
  }
  return output;
}

function pngAlpha(samples, header, palette, transparency, file) {
  const pixels = header.width * header.height;
  const alpha = Buffer.alloc(pixels, 255);
  if (header.colorType === 6) {
    for (let index = 0; index < pixels; index += 1) alpha[index] = samples[index * 4 + 3];
  } else if (header.colorType === 4) {
    for (let index = 0; index < pixels; index += 1) alpha[index] = samples[index * 2 + 1];
  } else if (header.colorType === 3) {
    if (!palette || palette.length === 0) throw new Error(`ASSET_PNG_PALETTE_INVALID:${file}`);
    for (let index = 0; index < pixels; index += 1) alpha[index] = transparency?.[samples[index]] ?? 255;
  } else if (header.colorType === 0 && transparency?.length >= 2) {
    const transparent = transparency.readUInt16BE(0);
    for (let index = 0; index < pixels; index += 1) alpha[index] = samples[index] === transparent ? 0 : 255;
  } else if (header.colorType === 2 && transparency?.length >= 6) {
    const red = transparency.readUInt16BE(0);
    const green = transparency.readUInt16BE(2);
    const blue = transparency.readUInt16BE(4);
    for (let index = 0; index < pixels; index += 1) {
      const source = index * 3;
      alpha[index] = samples[source] === red && samples[source + 1] === green && samples[source + 2] === blue ? 0 : 255;
    }
  }
  return { values: alpha, present: [4, 6].includes(header.colorType) || Boolean(transparency) };
}

function analyzeAlpha(alphaSource, width, height) {
  const { values, present } = alphaSource;
  let minimum = 255;
  let maximum = 0;
  let transparent = 0;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    if (value <= 16) transparent += 1;
  }
  const edgeOccupancy = {
    top: occupiedEdge(values, width, height, "top"),
    right: occupiedEdge(values, width, height, "right"),
    bottom: occupiedEdge(values, width, height, "bottom"),
    left: occupiedEdge(values, width, height, "left"),
  };
  return {
    present,
    minimum,
    maximum,
    transparentPixelRatio: transparent / values.length,
    edgeOccupancy,
    detachedEdgeComponents: present && transparent > 0
      ? countDetachedEdgeComponents(values, width, height)
      : 0,
  };
}

function occupiedEdge(alpha, width, height, side) {
  const length = side === "top" || side === "bottom" ? width : height;
  let occupied = 0;
  for (let index = 0; index < length; index += 1) {
    const x = side === "left" ? 0 : side === "right" ? width - 1 : index;
    const y = side === "top" ? 0 : side === "bottom" ? height - 1 : index;
    if (alpha[y * width + x] > 16) occupied += 1;
  }
  return occupied / length;
}

function countDetachedEdgeComponents(alpha, width, height) {
  const visited = new Uint8Array(alpha.length);
  const components = [];
  const queue = new Int32Array(alpha.length);
  for (let start = 0; start < alpha.length; start += 1) {
    if (visited[start] || alpha[start] <= 16) continue;
    let read = 0;
    let write = 1;
    let area = 0;
    let touchesEdge = false;
    queue[0] = start;
    visited[start] = 1;
    while (read < write) {
      const index = queue[read++];
      area += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) touchesEdge = true;
      if (x > 0) write = enqueueAlpha(index - 1, alpha, visited, queue, write);
      if (x + 1 < width) write = enqueueAlpha(index + 1, alpha, visited, queue, write);
      if (y > 0) write = enqueueAlpha(index - width, alpha, visited, queue, write);
      if (y + 1 < height) write = enqueueAlpha(index + width, alpha, visited, queue, write);
    }
    components.push({ area, touchesEdge });
  }
  if (components.length < 2) return 0;
  components.sort((left, right) => right.area - left.area);
  const minimumFragmentArea = Math.max(4, Math.ceil(components[0].area * 0.002));
  return components.slice(1).filter(({ area, touchesEdge }) => touchesEdge && area >= minimumFragmentArea).length;
}

function enqueueAlpha(index, alpha, visited, queue, write) {
  if (visited[index] || alpha[index] <= 16) return write;
  visited[index] = 1;
  queue[write] = index;
  return write + 1;
}

function pngChannels(colorType) {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  return 4;
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}
