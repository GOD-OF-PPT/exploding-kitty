export const VIEWPORT_KEYS = ["390x844", "372x749", "389x584"] as const;
export type ViewportKey = (typeof VIEWPORT_KEYS)[number];

export type ViewportProfile = Readonly<{
  key: ViewportKey;
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  capsule: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}>;

export const VIEWPORTS: Readonly<Record<ViewportKey, ViewportProfile>> = {
  "390x844": {
    key: "390x844",
    width: 390,
    height: 844,
    safeTop: 47,
    safeBottom: 34,
    capsule: { left: 298, top: 13, right: 385, bottom: 45 },
  },
  "372x749": {
    key: "372x749",
    width: 372,
    height: 749,
    safeTop: 44,
    safeBottom: 34,
    capsule: { left: 280, top: 12, right: 367, bottom: 44 },
  },
  "389x584": {
    key: "389x584",
    width: 389,
    height: 584,
    safeTop: 24,
    safeBottom: 0,
    capsule: { left: 296, top: 7, right: 384, bottom: 39 },
  },
};
