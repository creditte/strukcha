/**
 * User-friendly translator for XPM report upload (import) failures.
 *
 * Import problems are NOT Xero API problems — routing them through the Xero
 * translator produced misleading "reconnect Xero" wording and could flip the
 * Xero connection into a reconnect state. This module owns import messaging.
 *
 * Every message has: a short title, a plain sentence, a next action, and a
 * short reference code the user can quote to support. Raw server text is kept
 * separately so the UI can hide it behind a "Details" toggle.
 */

export type ImportErrorCode =
  | "file_too_large"
  | "file_unreadable"
  | "wrong_report"
  | "missing_columns"
  | "no_records"
  | "unauthorized"
  | "capacity_blocked"
  | "subscription_inactive"
  | "network"
  | "worker_timeout"
  | "database"
  | "unknown";

export interface FriendlyImportError {
  code: ImportErrorCode;
  /** Short reference the user can quote to support, e.g. IMP-TIMEOUT. */
  reference: string;
  title: string;
  message: string;
  resolution: string;
  retryable: boolean;
  /** Raw technical text, shown only behind a Details toggle. */
  detail: string;
}

const REFERENCE: Record<ImportErrorCode, string> = {
  file_too_large: "IMP-SIZE",
  file_unreadable: "IMP-READ",
  wrong_report: "IMP-FORMAT",
  missing_columns: "IMP-COLUMNS",
  no_records: "IMP-EMPTY",
  unauthorized: "IMP-AUTH",
  capacity_blocked: "IMP-LIMIT",
  subscription_inactive: "IMP-PLAN",
  network: "IMP-NET",
  worker_timeout: "IMP-TIMEOUT",
  database: "IMP-DB",
  unknown: "IMP-UNKNOWN",
};

/** Error carrying an explicit code, thrown by the upload page itself. */
export class ImportError extends Error {
  code: ImportErrorCode;
  detail: string;
  constructor(code: ImportErrorCode, message?: string, detail = "") {
    super(message ?? code);
    this.code = code;
    this.detail = detail;
  }
}

function rawSignal(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    for (const c of [o.detail, o.error, o.message]) {
      if (typeof c === "string" && c) return c;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "";
    }
  }
  return String(err);
}

function pickCode(err: unknown, raw: string): ImportErrorCode {
  if (err instanceof ImportError) return err.code;
  if (err && typeof err === "object") {
    const c = (err as Record<string, unknown>).code;
    if (typeof c === "string" && c in REFERENCE) return c as ImportErrorCode;
  }
  const has = (n: string) => raw.includes(n);

  if (has("payload too large") || has("request entity too large") || has("413") && has("large")) {
    return "file_too_large";
  }
  if (has("no records found") || has("0 records")) return "no_records";
  if (has("missing fileName") || has("missing filename") || has("required column")) {
    return "missing_columns";
  }
  if (has("unauthorized") || has("unauthorised") || has("no tenant")) return "unauthorized";
  if (has("subscription inactive") || has("subscription_inactive") || has("access locked")) {
    return "subscription_inactive";
  }
  if (has("structure limit") || has("structure_limit_reached") || has("maximum of")) {
    return "capacity_blocked";
  }
  if (has("taking longer than expected") || has("idle_timeout") || has("stopped responding") ||
      has("worker_resource_limit") || has("timed out") || has("timeout")) {
    return "worker_timeout";
  }
  if (has("failed to fetch") || has("network") || has("load failed") || has("connection")) {
    return "network";
  }
  if (has("import batch failed") || has("duplicate key") || has("violates") || has("sqlstate") ||
      has("relation ") || has("permission denied")) {
    return "database";
  }
  return "unknown";
}

export function translateImportError(err: unknown): FriendlyImportError {
  const detail = rawSignal(err);
  const code = pickCode(err, detail.toLowerCase());
  const base = { code, reference: REFERENCE[code], detail };

  switch (code) {
    case "file_too_large":
      return {
        ...base,
        title: "That file is too large to upload",
        message: "The report exceeds the size we can accept in a single upload.",
        resolution:
          "In Xero Practice Manager, export the Client Relationships Report in smaller batches (for example a few client groups at a time) and upload each file in turn.",
        retryable: false,
      };
    case "file_unreadable":
      return {
        ...base,
        title: "We couldn't read that file",
        message: "The file could not be opened as text, so nothing was imported.",
        resolution: "Re-export the report from Xero Practice Manager as CSV or XML and try again.",
        retryable: false,
      };
    case "wrong_report":
      return {
        ...base,
        title: "This doesn't look like a Client Relationships Report",
        message:
          "The file is readable, but it doesn't contain the client and relationship columns this import needs.",
        resolution:
          "In Xero Practice Manager go to Business › Reports, open the Client Relationships Report, and export it as CSV or XML.",
        retryable: false,
      };
    case "missing_columns":
      return {
        ...base,
        title: "Required columns are missing",
        message: "The file is missing the client name or relationship columns.",
        resolution:
          "Re-export the Client Relationships Report without removing or renaming any columns, then upload it again.",
        retryable: false,
      };
    case "no_records":
      return {
        ...base,
        title: "No records found in that file",
        message: "The file contains a header but no client rows.",
        resolution: "Check the report filters in Xero Practice Manager, re-export, and try again.",
        retryable: false,
      };
    case "unauthorized":
      return {
        ...base,
        title: "Your session has expired",
        message: "We couldn't confirm your sign-in for this workspace.",
        resolution: "Sign in again, then re-run the import.",
        retryable: false,
      };
    case "capacity_blocked":
      return {
        ...base,
        title: "No structure slots available",
        message: "Your plan's structure limit was reached, so new client groups can't be created.",
        resolution:
          "Archive or delete structures, or upgrade your plan, then run this import again to group the remaining clients.",
        retryable: false,
      };
    case "subscription_inactive":
      return {
        ...base,
        title: "Subscription isn't active",
        message: "New structures can't be created while the workspace subscription is inactive.",
        resolution: "Update billing in Settings › Billing, then run the import again.",
        retryable: false,
      };
    case "network":
      return {
        ...base,
        title: "Connection interrupted",
        message: "The upload lost its connection before finishing.",
        resolution:
          "Check your internet connection and try again. Any records already imported are kept, so re-running is safe.",
        retryable: true,
      };
    case "worker_timeout":
      return {
        ...base,
        title: "The import ran out of time",
        message:
          "Processing stopped before the whole file was finished. Everything imported up to that point was saved.",
        resolution: "Resume the import to continue from where it stopped.",
        retryable: true,
      };
    case "database":
      return {
        ...base,
        title: "The import couldn't be saved",
        message: "Part of the file could not be written to your workspace.",
        resolution:
          "Try again in a moment. If it keeps happening, email hello@strukcha.app and quote reference IMP-DB.",
        retryable: true,
      };
    default:
      return {
        ...base,
        title: "The import didn't complete",
        message: "Something unexpected stopped the import.",
        resolution:
          "Try again. If the problem persists, email hello@strukcha.app and quote reference IMP-UNKNOWN.",
        retryable: true,
      };
  }
}

export function importToastPayload(err: unknown): { title: string; description: string } {
  const f = translateImportError(err);
  return { title: f.title, description: `${f.message} ${f.resolution}`.trim() };
}

/** Read the JSON body of a Supabase FunctionsHttpError so we get the real reason. */
export async function readFunctionError(err: unknown): Promise<unknown> {
  try {
    const ctx = (err as { context?: unknown } | null)?.context;
    if (ctx && typeof (ctx as Response).clone === "function") {
      const res = (ctx as Response).clone();
      const text = await res.text().catch(() => "");
      try {
        const parsed = JSON.parse(text);
        return {
          code: parsed?.code,
          message: parsed?.error ?? parsed?.message ?? text.slice(0, 300),
          detail: parsed?.detail ?? text.slice(0, 500),
        };
      } catch {
        return { message: text.slice(0, 300) || "Upload failed", detail: text.slice(0, 500) };
      }
    }
  } catch {
    /* ignore */
  }
  return err;
}
