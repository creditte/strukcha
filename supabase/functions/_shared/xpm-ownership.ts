/**
 * XPM ownership figures. XPM sends `NumberOfShares` and `Percentage` per
 * relationship. Rules: a zero or blank figure means "not supplied" (null);
 * shares are units, never converted to a percentage; a percentage is never
 * inferred from units. Only types whose policy allows a field keep it.
 */
import { policyMetadataFields } from "./relationship-policy.ts";

export interface XpmFigures {
  units: number | null;
  percent: number | null;
}

export function parseXpmNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/,/g, "").replace(/%$/, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Raw XPM figures → stored figures (zero/blank/negative → null). */
export function normaliseXpmOwnership(raw: { shares?: unknown; percentage?: unknown }): XpmFigures {
  const units = parseXpmNumber(raw.shares);
  const percent = parseXpmNumber(raw.percentage);
  return {
    units: units !== null && units > 0 ? units : null,
    percent: percent !== null && percent > 0 ? percent : null,
  };
}

/**
 * Figures that may be written for a canonical edge, or null when the policy
 * allows no ownership figures for that type/target (no metadata write).
 */
export function figuresForEdge(type: string, targetDbType: string | undefined, figures: XpmFigures): XpmFigures | null {
  const fields = policyMetadataFields(type, targetDbType);
  const allowUnits = fields.includes("ownership_units");
  const allowPercent = fields.includes("ownership_percent");
  if (!allowUnits && !allowPercent) return null;
  return {
    units: allowUnits ? figures.units : null,
    percent: allowPercent ? figures.percent : null,
  };
}
