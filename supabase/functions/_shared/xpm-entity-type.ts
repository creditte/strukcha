/**
 * Single source of truth for turning XPM's business-structure wording into a
 * strukcha entity type. Imported by sync-xpm, fetch-xpm-group and
 * import-xpm-group so the live group preview, a single-group import and a full
 * sync can never disagree about what a client is.
 */

export const BUSINESS_STRUCTURE_MAP: Record<string, string> = {
  Individual: "Individual",
  Company: "Company",
  Trust: "Trust",
  Partnership: "Partnership",
  "Sole Trader": "Sole Trader",
  "Trustee Company": "Company",
  "Discretionary Trust": "trust_discretionary",
  "Unit Trust": "trust_unit",
  "Hybrid Trust": "trust_hybrid",
  "Bare Trust": "trust_bare",
  "Testamentary Trust": "trust_testamentary",
  "Deceased Estate": "trust_deceased_estate",
  "Family Trust": "trust_family",
  "Self Managed Superannuation Fund": "smsf",
  SMSF: "smsf",
  "Super Fund": "smsf",
  SuperFund: "smsf",
};

/**
 * Classify by keyword when XPM's exact wording isn't in the table.
 *
 * Firms type their own business-structure labels in XPM ("Discretionary Trading
 * Trust", "Australian Private Company"), so an exact-match table alone leaves
 * real trusts and companies Unclassified.
 */
export function inferTypeFromText(text: string): string | null {
  const s = text.toLowerCase();
  if (/smsf|self[- ]managed|superannuation fund|super fund/.test(s)) return "smsf";
  if (/unit trust/.test(s)) return "trust_unit";
  if (/hybrid trust/.test(s)) return "trust_hybrid";
  if (/bare trust/.test(s)) return "trust_bare";
  if (/testamentary/.test(s)) return "trust_testamentary";
  if (/deceased estate/.test(s)) return "trust_deceased_estate";
  if (/family trust/.test(s)) return "trust_family";
  if (/discretionary/.test(s)) return "trust_discretionary";
  if (/\btrust\b|trustee for/.test(s)) return "Trust";
  if (/partnership/.test(s)) return "Partnership";
  if (/sole trader/.test(s)) return "Sole Trader";
  if (/incorporated association|\bclub\b/.test(s)) return "Incorporated Association/Club";
  if (/\bcompany\b|pty\s*\.?\s*ltd|proprietary|\blimited\b|\bltd\b|\bpl\b$/.test(s)) return "Company";
  if (/individual|\bperson\b/.test(s)) return "Individual";
  return null;
}

/**
 * `businessStructure` is authoritative; the client name is a fallback so a blank
 * or unrecognised structure still classifies obvious trusts and companies.
 */
export function resolveEntityType(businessStructure?: string, clientName?: string): string {
  if (businessStructure) {
    const mapped = BUSINESS_STRUCTURE_MAP[businessStructure];
    if (mapped) return mapped;
    const lower = businessStructure.toLowerCase();
    for (const [key, val] of Object.entries(BUSINESS_STRUCTURE_MAP)) {
      if (key.toLowerCase() === lower) return val;
    }
    const inferred = inferTypeFromText(businessStructure);
    if (inferred) return inferred;
  }
  if (clientName) {
    const inferred = inferTypeFromText(clientName);
    if (inferred) return inferred;
  }
  return "Unclassified";
}
