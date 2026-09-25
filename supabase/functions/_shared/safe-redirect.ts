// Where OAuth callbacks may send the browser afterwards. Deliberately stricter
// than the CORS list: any *.lovable.app site could be someone else's app.
const PROJECT_ID = "c2bb257c-4871-434e-890c-c3844642f1db";

const ALLOWED = new Set([
  "https://strukcha.app",
  "https://www.strukcha.app",
  "https://strukcha-dev.lovable.app",
  `https://id-preview--${PROJECT_ID}.lovable.app`,
  `https://preview--${PROJECT_ID}.lovable.app`,
  `https://${PROJECT_ID}.lovableproject.com`,
  "http://localhost:8080",
  "http://localhost:5173",
]);

export function defaultFrontend(): string {
  return (Deno.env.get("FRONTEND_URL") ?? "").trim().replace(/\/$/, "") ||
    "https://strukcha-dev.lovable.app";
}

/** Returns the origin if it is one of strukcha's own sites, otherwise the default. */
export function safeFrontend(candidate: unknown): string {
  if (typeof candidate !== "string" || !candidate) return defaultFrontend();
  let origin: string;
  try {
    origin = new URL(candidate).origin;
  } catch {
    return defaultFrontend();
  }
  if (origin === defaultFrontend() || ALLOWED.has(origin)) return origin;
  console.warn("[safe-redirect] rejected origin:", origin);
  return defaultFrontend();
}
