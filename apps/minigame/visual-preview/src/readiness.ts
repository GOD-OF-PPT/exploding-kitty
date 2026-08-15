export type FontSetLike = Readonly<{
  load(font: string, text?: string): Promise<readonly unknown[]>;
  check(font: string, text?: string): boolean;
  ready: PromiseLike<unknown>;
}>;

export type DecodableImage = Readonly<{
  src?: string;
  width?: number;
  naturalWidth?: number;
  decode?: () => Promise<void>;
}>;

export type CanvasStabilityOptions = Readonly<{
  stableSamples?: number;
  maxSamples?: number;
  settle?: () => Promise<void>;
  nextFrame?: () => Promise<void>;
  hash?: (canvas: HTMLCanvasElement) => string;
}>;

export type CanvasStabilityResult = Readonly<{
  hash: string;
  samples: number;
  stableSamples: number;
}>;

const DEFAULT_STABLE_SAMPLES = 3;
const DEFAULT_FRAMES_BETWEEN_SAMPLES = 6;
const DEFAULT_MAX_SAMPLES = 120;
const DEFAULT_SETTLE_MS = 1_000;
const FONT_SAMPLE = "炸毛危机今晚谁先炸";

export async function waitForDisplayFont(fonts: FontSetLike | undefined, family: string): Promise<void> {
  if (!fonts) throw new Error("VISUAL_PREVIEW_FONT_API_MISSING");
  const descriptor = `16px "${family}"`;
  await fonts.load(descriptor, FONT_SAMPLE);
  await fonts.ready;
  if (!fonts.check(descriptor, FONT_SAMPLE)) throw new Error(`VISUAL_PREVIEW_FONT_NOT_READY:${family}`);
}

export async function waitForDecodedImages(
  images: readonly (DecodableImage | null)[],
  errorCode: string,
): Promise<void> {
  await Promise.all(images.map(async (image, index) => {
    if (!image) throw new Error(`${errorCode}:${index}`);
    if (image.decode) await image.decode();
    const width = Number(image.naturalWidth || image.width || 0);
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error(`${errorCode}:${image.src || index}`);
    }
  }));
}

export async function waitForCanvasStability(
  canvas: HTMLCanvasElement,
  options: CanvasStabilityOptions = {},
): Promise<CanvasStabilityResult> {
  const stableSamples = options.stableSamples ?? DEFAULT_STABLE_SAMPLES;
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  if (!Number.isInteger(stableSamples) || stableSamples < 2) {
    throw new Error(`VISUAL_PREVIEW_STABLE_SAMPLE_COUNT_INVALID:${stableSamples}`);
  }
  if (!Number.isInteger(maxSamples) || maxSamples < stableSamples) {
    throw new Error(`VISUAL_PREVIEW_MAX_SAMPLE_COUNT_INVALID:${maxSamples}`);
  }

  const nextFrame = options.nextFrame ?? animationFrame;
  const hash = options.hash ?? hashCanvasPixels;
  await (options.settle ?? settleDelay)();
  let previous = "";
  let consecutive = 0;
  for (let sample = 1; sample <= maxSamples; sample += 1) {
    await nextFrame();
    const current = hash(canvas);
    consecutive = current === previous ? consecutive + 1 : 1;
    previous = current;
    if (consecutive >= stableSamples) return { hash: current, samples: sample, stableSamples: consecutive };
  }
  throw new Error(`VISUAL_PREVIEW_CANVAS_UNSTABLE:${maxSamples}`);
}

export function hashCanvasPixels(canvas: HTMLCanvasElement): string {
  if (canvas.width <= 0 || canvas.height <= 0) throw new Error("VISUAL_PREVIEW_CANVAS_EMPTY");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("VISUAL_PREVIEW_CANVAS_HASH_CONTEXT_MISSING");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 0x811c9dc5;
  hash = fnvByte(hash, canvas.width & 0xff);
  hash = fnvByte(hash, canvas.width >>> 8 & 0xff);
  hash = fnvByte(hash, canvas.height & 0xff);
  hash = fnvByte(hash, canvas.height >>> 8 & 0xff);
  for (let index = 0; index < pixels.length; index += 1) hash = fnvByte(hash, pixels[index]!);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fnvByte(hash: number, value: number): number {
  return Math.imul(hash ^ value, 0x01000193);
}

function animationFrame(): Promise<void> {
  return new Promise((resolve) => {
    let remaining = DEFAULT_FRAMES_BETWEEN_SAMPLES;
    const advance = (): void => {
      remaining -= 1;
      if (remaining === 0) resolve();
      else requestAnimationFrame(advance);
    };
    requestAnimationFrame(advance);
  });
}

function settleDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DEFAULT_SETTLE_MS));
}
