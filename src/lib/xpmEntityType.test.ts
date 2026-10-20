import { describe, it, expect } from "vitest";
import { resolveEntityType } from "../../supabase/functions/_shared/xpm-entity-type";

describe("XPM entity type", () => {
  it("XPM 'Sole Trader' clients are stored as Individuals", () => {
    expect(resolveEntityType("Sole Trader", "Stephen Dart")).toBe("Individual");
    expect(resolveEntityType("sole trader")).toBe("Individual");
  });
  it("custom sole-trader wording also becomes Individual", () => {
    expect(resolveEntityType("Sole Trader - Plumbing")).toBe("Individual");
  });
});

import { xpmTypeCorrection } from "../../supabase/functions/_shared/xpm-entity-type";

describe("XPM stored Sole Trader correction", () => {
  it("stored Sole Trader that XPM calls a sole trader, with no Trades As owner, becomes Individual", () => {
    expect(xpmTypeCorrection("Sole Trader", "Sole Trader", false)).toBe("Individual");
  });
  it("keeps the Sole Trader type when a Trades As owner exists", () => {
    expect(xpmTypeCorrection("Sole Trader", "Sole Trader", true)).toBeNull();
  });
  it("never changes a client XPM does not call a sole trader", () => {
    expect(xpmTypeCorrection("Sole Trader", "Individual", false)).toBeNull();
    expect(xpmTypeCorrection("Company", "Sole Trader", false)).toBeNull();
  });
});
