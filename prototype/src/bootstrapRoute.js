const LEGACY_GALLERY_ROUTES = new Set([
  "login", "home", "play-mode", "create", "join", "lobby", "lobby-member", "game", "other-turn", "response",
  "favor", "give-card", "defuse", "future", "explosion", "attack-debt", "eliminated", "result", "tutorial", "rules",
  "card-detail", "history", "game-menu", "network", "settings",
]);

export function resolveBootstrapRoute(hash, dev = false) {
  const hashRoute = String(hash || "").replace(/^#/, "");
  if (!dev) return { surface: "live", route: hashRoute };
  if (hashRoute.startsWith("audit/")) return { surface: "audit", route: hashRoute.slice("audit/".length) };
  if (hashRoute === "gallery" || hashRoute.startsWith("gallery/") || LEGACY_GALLERY_ROUTES.has(hashRoute)) {
    return { surface: "gallery", route: hashRoute };
  }
  return { surface: "live", route: hashRoute };
}
