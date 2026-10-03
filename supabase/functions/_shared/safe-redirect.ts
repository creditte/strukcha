// Kept for existing imports; all logic lives in frontend-url.ts.
import { canonicalFrontend, resolveFrontend } from "./frontend-url.ts";

export function defaultFrontend(): string {
  return canonicalFrontend();
}

/** Returns the origin if it is one of strukcha's own sites, otherwise the canonical one. */
export function safeFrontend(candidate: unknown): string {
  return resolveFrontend(candidate);
}
