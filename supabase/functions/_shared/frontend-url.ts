// Single source for every backend-generated link back to the strukcha app
// (Xero redirects, email links, password reset, Stripe success/cancel).
//
// - FRONTEND_URL is used when it is a valid origin on the allow-list below
//   (an unknown or stale value, e.g. an old project address, is ignored).
// - A caller-supplied origin is accepted only if it is on the explicit allow-list
//   below; anything else falls back to the canonical origin. Never reflected.

const PROJECT_ID = "c2bb257c-4871-434e-890c-c3844642f1db";

/** Used only when FRONTEND_URL is missing or invalid. */
export const CANONICAL_FALLBACK = "https://www.strukcha.app";

export const ALLOWED_FRONTEND_ORIGINS: readonly string[] = [
  "https://strukcha.app",
  "https://www.strukcha.app",
  "https://strukcha-dev.lovable.app",
  "https://preview--strukcha-dev.lovable.app",
  `https://id-preview--${PROJECT_ID}.lovable.app`,
  `https://preview--${PROJECT_ID}.lovable.app`,
  `https://${PROJECT_ID}.lovableproject.com`,
  "http://localhost:8080",
  "http://localhost:5173",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Returns a clean origin, or null if the value is not a usable app origin. */
export function normaliseOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

/** Canonical app origin from the configured value. Localhost is rejected unless allowLocal. */
export function canonicalFrontendFrom(configured: unknown, allowLocal = false): string {
  const origin = normaliseOrigin(configured);
  if (!origin || !ALLOWED_FRONTEND_ORIGINS.includes(origin)) return CANONICAL_FALLBACK;
  if (!allowLocal && LOCAL_HOSTS.has(new URL(origin).hostname)) return CANONICAL_FALLBACK;
  return origin;
}

/** Caller origin if explicitly allow-listed (or equal to the canonical one), else canonical. */
export function resolveFrontendFrom(candidate: unknown, configured: unknown, allowLocal = false): string {
  const canonical = canonicalFrontendFrom(configured, allowLocal);
  const origin = normaliseOrigin(candidate);
  if (!origin) return canonical;
  if (origin === canonical || ALLOWED_FRONTEND_ORIGINS.includes(origin)) return origin;
  return canonical;
}

/** Joins a path onto an origin, dropping any query/hash on the origin. */
export function frontendLink(origin: string, path: string): string {
  const url = new URL(origin);
  url.pathname = path.startsWith("/") ? path : `/${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

// ── Deno wrappers ──────────────────────────────────────────────────────────
function env(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).Deno?.env?.get?.(name);
}
function localRuntime(): boolean {
  const u = env("SUPABASE_URL") ?? "";
  return u.includes("127.0.0.1") || u.includes("localhost");
}

export function canonicalFrontend(): string {
  return canonicalFrontendFrom(env("FRONTEND_URL"), localRuntime());
}

export function resolveFrontend(candidate: unknown): string {
  return resolveFrontendFrom(candidate, env("FRONTEND_URL"), localRuntime());
}

/** Readiness summary for super admins; contains no secrets. */
export function frontendConfigStatus(): { configured: boolean; valid: boolean; origin: string } {
  const raw = env("FRONTEND_URL");
  const o = normaliseOrigin(raw);
  const valid = !!o && ALLOWED_FRONTEND_ORIGINS.includes(o);
  return { configured: !!(raw && raw.trim()), valid, origin: canonicalFrontend() };
}
