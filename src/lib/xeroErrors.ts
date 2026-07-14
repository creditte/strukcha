/**
 * User-friendly Xero / XPM error translator.
 *
 * Takes any error thrown from a Xero-related edge function call (Supabase
 * FunctionsHttpError, plain Error, string, or object) and returns a plain
 * message the user can act on. Raw HTTP status codes, JSON payloads and
 * stack traces are never surfaced.
 *
 * This is used across every Xero touch-point in the app (dashboard sync,
 * settings integrations, imports, group viewer, structure list) so that
 * the UX meets Xero App Store certification requirements.
 */

export type XeroErrorKind =
  | "not_connected"
  | "auth_expired"
  | "permission"
  | "rate_limit"
  | "not_found"
  | "validation"
  | "unavailable"
  | "network"
  | "unknown";

export interface FriendlyXeroError {
  kind: XeroErrorKind;
  /** Short heading, safe for a toast title or alert heading. */
  title: string;
  /** Plain-English description of what went wrong. */
  message: string;
  /** Suggested next step for the user. */
  resolution: string;
  /** True when a simple "Try again" action is likely to succeed. */
  retryable: boolean;
  /** True when the user needs to re-authorise the Xero connection. */
  requiresReconnect: boolean;
}

/** Best-effort extraction of a raw string from anything a caller might pass. */
function rawSignal(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    const candidates = [
      anyErr.detail,
      anyErr.error,
      anyErr.message,
      (anyErr.context as Record<string, unknown> | undefined)?.error,
      (anyErr.context as Record<string, unknown> | undefined)?.message,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) return c;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "";
    }
  }
  return String(err);
}

function pickStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as Record<string, unknown>;
  const direct = (anyErr.status ?? anyErr.statusCode ?? anyErr.code) as unknown;
  if (typeof direct === "number") return direct;
  const ctx = anyErr.context as Record<string, unknown> | undefined;
  if (ctx && typeof ctx.status === "number") return ctx.status as number;
  return null;
}

/**
 * Async variant that also reads the response body of a Supabase
 * FunctionsHttpError (whose `.context` is a `Response`). Our edge functions
 * return `{ error: "…" }` JSON on non-2xx, so parsing the body lets us
 * surface a specific, user-friendly reason instead of the generic
 * "Edge Function returned a non-2xx status code" fallback.
 */
export async function translateXeroErrorAsync(err: unknown): Promise<FriendlyXeroError> {
  try {
    const ctx = (err as { context?: unknown } | null)?.context;
    if (ctx && typeof (ctx as Response).clone === "function") {
      const res = (ctx as Response).clone();
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch {
        /* ignore */
      }
      let bodyMsg = "";
      try {
        const parsed = JSON.parse(bodyText);
        bodyMsg =
          (typeof parsed?.error === "string" && parsed.error) ||
          (typeof parsed?.message === "string" && parsed.message) ||
          (typeof parsed?.detail === "string" && parsed.detail) ||
          "";
      } catch {
        bodyMsg = bodyText.slice(0, 300);
      }
      return translateXeroError({ message: bodyMsg, status: (ctx as Response).status });
    }
  } catch {
    /* fall through */
  }
  return translateXeroError(err);
}

export function translateXeroError(err: unknown): FriendlyXeroError {
  const raw = rawSignal(err).toLowerCase();
  const status = pickStatus(err);

  const has = (needle: string) => raw.includes(needle);

  // Not connected at all — internal signal from our edge functions.
  if (has("no xero connection") || has("xero not connected") || has("no active xero")) {
    return {
      kind: "not_connected",
      title: "Xero is not connected",
      message: "Your firm doesn't have an active Xero connection yet.",
      resolution: "Connect Xero from Settings › Integrations, then try again.",
      retryable: false,
      requiresReconnect: true,
    };
  }

  // Auth / token issues.
  if (
    status === 401 ||
    has("unauthorized") ||
    has("unauthorised") ||
    has("token_expired") ||
    has("invalid_token") ||
    has("token refresh failed") ||
    has("refresh token") ||
    has("re-authorise") ||
    has("reauthorise") ||
    has("reauthorize")
  ) {
    return {
      kind: "auth_expired",
      title: "Xero sign-in expired",
      message: "Your Xero connection has expired or been revoked.",
      resolution: "Reconnect Xero from Settings › Integrations to restore access.",
      retryable: false,
      requiresReconnect: true,
    };
  }

  // Permission / scope issues.
  if (
    status === 403 ||
    has("forbidden") ||
    has("insufficient scope") ||
    has("scope") && has("missing") ||
    has("permission")
  ) {
    return {
      kind: "permission",
      title: "Missing Xero permissions",
      message:
        "The Xero user who connected this account doesn't have permission to access the requested data.",
      resolution:
        "Ask a Xero administrator to reconnect with Practice Manager access, or check the user's role in Xero.",
      retryable: false,
      requiresReconnect: true,
    };
  }

  // Rate limit.
  if (status === 429 || has("rate limit") || has("too many requests")) {
    return {
      kind: "rate_limit",
      title: "Xero is rate-limiting requests",
      message: "We've hit Xero's short-term request limit for your organisation.",
      resolution: "Wait about a minute, then try again.",
      retryable: true,
      requiresReconnect: false,
    };
  }

  // Not found (tenant / organisation / resource).
  if (
    status === 404 ||
    has("not found") ||
    has("tenant id not available") ||
    has("no tenant") ||
    has("organisation not found")
  ) {
    return {
      kind: "not_found",
      title: "Xero data not found",
      message:
        "We couldn't find the requested Xero organisation or record. It may have been renamed, removed, or your connection may point at a different organisation.",
      resolution:
        "Refresh the list, or reconnect Xero from Settings › Integrations to choose the correct organisation.",
      retryable: true,
      requiresReconnect: false,
    };
  }

  // Validation issues.
  if (status === 400 || status === 422 || has("validation") || has("invalid")) {
    return {
      kind: "validation",
      title: "Xero couldn't accept the request",
      message:
        "Xero rejected one or more values in this request. This usually means a required field is missing or a value doesn't match Xero's format.",
      resolution:
        "Review the affected record in Xero, correct any missing or invalid details, then try again.",
      retryable: true,
      requiresReconnect: false,
    };
  }

  // Server / gateway issues.
  if (
    (typeof status === "number" && status >= 500 && status < 600) ||
    has("unavailable") ||
    has("bad gateway") ||
    has("gateway timeout") ||
    has("timed out") ||
    has("timeout") ||
    has("worker_resource_limit")
  ) {
    return {
      kind: "unavailable",
      title: "Xero is temporarily unavailable",
      message: "Xero didn't respond in time. This is usually a short-lived outage on Xero's side.",
      resolution: "Wait a moment and try again. If it keeps happening, check status.xero.com.",
      retryable: true,
      requiresReconnect: false,
    };
  }

  // Network / fetch failures.
  if (has("failed to fetch") || has("network") || has("networkerror") || has("load failed")) {
    return {
      kind: "network",
      title: "Can't reach Xero",
      message: "We couldn't reach Xero from your browser.",
      resolution: "Check your internet connection and try again.",
      retryable: true,
      requiresReconnect: false,
    };
  }

  return {
    kind: "unknown",
    title: "Something went wrong with Xero",
    message: "We couldn't complete that Xero request.",
    resolution: "Please try again. If the problem persists, contact support at hello@strukcha.app.",
    retryable: true,
    requiresReconnect: false,
  };
}

/** Convenience for one-line sonner/toast usage. */
export function xeroToastPayload(err: unknown): { title: string; description: string } {
  const f = translateXeroError(err);
  return {
    title: f.title,
    description: `${f.message} ${f.resolution}`.trim(),
  };
}
