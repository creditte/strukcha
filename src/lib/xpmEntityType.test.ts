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
