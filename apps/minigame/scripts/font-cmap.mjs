export function collectRequiredDisplayCodePoints(strings) {
  const required = new Set();
  for (const text of strings) {
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined && !isIgnoredControl(codePoint)) required.add(codePoint);
    }
  }
  return required;
}

export function readTtfUnicodeCmap(font) {
  ensureRange(font, 0, 12, "sfnt header");
  const tableCount = font.readUInt16BE(4);
  ensureRange(font, 12, tableCount * 16, "table directory");

  let cmapOffset = null;
  let cmapLength = null;
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    if (font.toString("ascii", recordOffset, recordOffset + 4) !== "cmap") continue;
    cmapOffset = font.readUInt32BE(recordOffset + 8);
    cmapLength = font.readUInt32BE(recordOffset + 12);
    break;
  }
  if (cmapOffset === null || cmapLength === null) throw new Error("Display TTF has no cmap table.");
  ensureRange(font, cmapOffset, cmapLength, "cmap table");
  ensureRange(font, cmapOffset, 4, "cmap header");
  if (font.readUInt16BE(cmapOffset) !== 0) throw new Error("Display TTF has an unsupported cmap version.");

  const encodingCount = font.readUInt16BE(cmapOffset + 2);
  ensureRange(font, cmapOffset + 4, encodingCount * 8, "cmap encoding records");
  const codePoints = new Set();
  const parsedSubtables = new Set();
  let supportedSubtableCount = 0;

  for (let index = 0; index < encodingCount; index += 1) {
    const recordOffset = cmapOffset + 4 + index * 8;
    const platform = font.readUInt16BE(recordOffset);
    const encoding = font.readUInt16BE(recordOffset + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;

    const subtableOffset = cmapOffset + font.readUInt32BE(recordOffset + 4);
    if (parsedSubtables.has(subtableOffset)) continue;
    parsedSubtables.add(subtableOffset);
    ensureRange(font, subtableOffset, 2, "cmap subtable header");
    const format = font.readUInt16BE(subtableOffset);
    if (format === 4) {
      addFormat4CodePoints(font, subtableOffset, codePoints);
      supportedSubtableCount += 1;
    } else if (format === 12) {
      addFormat12CodePoints(font, subtableOffset, codePoints);
      supportedSubtableCount += 1;
    }
  }

  if (supportedSubtableCount === 0) {
    throw new Error("Display TTF has no supported Unicode cmap subtable (format 4 or 12).");
  }
  return codePoints;
}

export function formatCodePoint(codePoint) {
  const character = String.fromCodePoint(codePoint);
  return `${character} (U+${codePoint.toString(16).toUpperCase().padStart(4, "0")})`;
}

function isIgnoredControl(codePoint) {
  return codePoint < 0x20 && codePoint !== 0x09;
}

function addFormat4CodePoints(font, offset, codePoints) {
  ensureRange(font, offset, 8, "format 4 header");
  const length = font.readUInt16BE(offset + 2);
  ensureRange(font, offset, length, "format 4 subtable");
  const segmentCount = font.readUInt16BE(offset + 6) / 2;
  if (!Number.isInteger(segmentCount) || segmentCount <= 0) throw new Error("Display TTF has an invalid format 4 cmap.");

  const endCodeOffset = offset + 14;
  const startCodeOffset = endCodeOffset + segmentCount * 2 + 2;
  const deltaOffset = startCodeOffset + segmentCount * 2;
  const rangeOffset = deltaOffset + segmentCount * 2;
  ensureRange(font, rangeOffset, segmentCount * 2, "format 4 segments");
  const subtableEnd = offset + length;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = font.readUInt16BE(startCodeOffset + index * 2);
    const end = font.readUInt16BE(endCodeOffset + index * 2);
    if (end < start) throw new Error("Display TTF has an invalid format 4 cmap range.");
    const delta = font.readInt16BE(deltaOffset + index * 2);
    const rangeWordOffset = rangeOffset + index * 2;
    const glyphRangeOffset = font.readUInt16BE(rangeWordOffset);

    for (let codePoint = start; codePoint <= end && codePoint !== 0xffff; codePoint += 1) {
      let glyph;
      if (glyphRangeOffset === 0) {
        glyph = (codePoint + delta) & 0xffff;
      } else {
        const glyphOffset = rangeWordOffset + glyphRangeOffset + (codePoint - start) * 2;
        if (glyphOffset + 2 > subtableEnd) throw new Error("Display TTF has an invalid format 4 glyph offset.");
        glyph = font.readUInt16BE(glyphOffset);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) codePoints.add(codePoint);
    }
  }
}

function addFormat12CodePoints(font, offset, codePoints) {
  ensureRange(font, offset, 16, "format 12 header");
  const length = font.readUInt32BE(offset + 4);
  ensureRange(font, offset, length, "format 12 subtable");
  const groupCount = font.readUInt32BE(offset + 12);
  ensureRange(font, offset + 16, groupCount * 12, "format 12 groups");

  for (let index = 0; index < groupCount; index += 1) {
    const groupOffset = offset + 16 + index * 12;
    const start = font.readUInt32BE(groupOffset);
    const end = font.readUInt32BE(groupOffset + 4);
    const firstGlyph = font.readUInt32BE(groupOffset + 8);
    if (end < start || end > 0x10ffff) throw new Error("Display TTF has an invalid format 12 cmap range.");
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      if (firstGlyph + codePoint - start !== 0) codePoints.add(codePoint);
    }
  }
}

function ensureRange(buffer, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`Display TTF has an invalid ${label}.`);
  }
}
