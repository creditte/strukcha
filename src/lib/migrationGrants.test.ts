// Guards the Data API rule: from 30/10/2026 new public tables get no automatic
// grants, so every CREATE TABLE in public must be covered by an explicit GRANT
// (in the same migration, or in the explicit-grants baseline for old tables).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BASELINE_MARKER = "-- data-api-explicit-grants-baseline";

function sqlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sqlFiles(p);
    return p.endsWith(".sql") && !/ROLLBACK/i.test(f) ? [p] : [];
  });
}

const strip = (s: string) => s.replace(/--[^\n]*/g, "");

function createdTables(sql: string): string[] {
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)"?(\w+)"?/gi;
  return [...strip(sql).matchAll(re)].map((m) => m[1].toLowerCase());
}

function grantedTables(sql: string, role: string): Set<string> {
  const out = new Set<string>();
  const re = /grant\s+[\w\s,]+?\s+on\s+(?:table\s+)?([\w."\s,]+?)\s+to\s+([\w\s,]+?);/gi;
  for (const m of strip(sql).matchAll(re)) {
    if (!m[2].toLowerCase().split(/[\s,]+/).includes(role)) continue;
    for (const t of m[1].split(",")) {
      const name = t.trim().replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
      if (name) out.add(name);
    }
  }
  return out;
}

const migrations = sqlFiles("supabase/migrations").sort();
const baselineFile = migrations.find((f) => readFileSync(f, "utf8").includes(BASELINE_MARKER));
const baselineGrants = baselineFile ? grantedTables(readFileSync(baselineFile, "utf8"), "service_role") : new Set<string>();

describe("Data API grants in migrations", () => {
  it("has an explicit-grants baseline migration", () => {
    expect(baselineFile).toBeDefined();
  });

  for (const dir of ["supabase/migrations", "supabase/pending-migrations"]) {
    it(`every public table created in ${dir} has service_role + authenticated grants`, () => {
      const missing: string[] = [];
      for (const f of sqlFiles(dir)) {
        const sql = readFileSync(f, "utf8");
        const sr = grantedTables(sql, "service_role");
        const au = grantedTables(sql, "authenticated");
        for (const t of createdTables(sql)) {
          const inBaseline = dir === "supabase/migrations" && baselineGrants.has(t);
          if (!inBaseline && (!sr.has(t) || !au.has(t))) missing.push(`${f}: ${t}`);
        }
      }
      expect(missing).toEqual([]);
    });
  }

  it("the baseline never grants anything to anon", () => {
    expect(baselineFile && grantedTables(readFileSync(baselineFile, "utf8"), "anon").size).toBe(0);
  });
});
