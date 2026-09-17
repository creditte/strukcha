// Shared CORS handling for app-facing edge functions.
//
// Browser callers are restricted to an allow-list: the configured production
// frontend (FRONTEND_URL), Lovable preview/published hosts, and localhost dev.
// Non-browser callers (no Origin header) are unaffected.
//
// Public endpoints that third parties must call (Stripe/smtp2go webhooks,
// OAuth redirect callbacks, cron triggers) intentionally do NOT use this helper.

const ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

const STATIC_ALLOWED = [
  "https://strukcha.app",
  "https://www.strukcha.app",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
];

const HOST_SUFFIXES = [".lovable.app", ".lovableproject.com", ".lovable.dev"];

function fallbackOrigin(): string {
  const configured = (Deno.env.get("FRONTEND_URL") ?? "").trim();
  return configured || STATIC_ALLOWED[0];
}

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  const configured = (Deno.env.get("FRONTEND_URL") ?? "").trim().replace(/\/$/, "");
  if (configured && origin === configured) return true;
  if (STATIC_ALLOWED.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:" && protocol !== "http:") return false;
    return HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

/** CORS headers for this request, echoing the origin only when allow-listed. */
export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = isAllowedOrigin(origin) ? origin : fallbackOrigin();
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
