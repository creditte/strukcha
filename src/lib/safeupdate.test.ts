/**
 * The live backend enforces pg_safeupdate: UPDATE / DELETE without WHERE is
 * refused at runtime. PGlite has no such extension, so this test emulates it
 * statically over the pending SQL that will run through the Data API.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../supabase/pending-migrations");
// 013 is already applied and superseded by 014 (the safeupdate hotfix).
const SUPERSEDED = new Set(["phase2/013_xpm_batch_functions_policy.sql"]);

function sqlFiles(dir: string, rel = ""): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const r = rel ? `${rel}/${n}` : n;
    return statSync(p).isDirectory() ? sqlFiles(p, r) : n.endsWith(".sql") ? [r] : [];
  });
}

export function unfilteredStatements(sql: string): string[] {
  const clean = sql.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
  const out: string[] = [];
  for (const stmt of clean.split(";")) {
    const m = stmt.match(/\b(UPDATE\s+[\w.]+(?:\s+\w+)?\s+SET\b|DELETE\s+FROM\b)/i);
    if (!m || m.index === undefined) continue;
    // Skip DDL mentions like "ON UPDATE" / "FOR UPDATE" / trigger events.
    if (/\b(ON|FOR|OR|BEFORE|AFTER)\s*$/i.test(stmt.slice(0, m.index).trimEnd())) continue;
    if (!/\bWHERE\b/i.test(stmt.slice(m.index))) out.push(stmt.trim().slice(0, 120));
  }
  return out;
}

describe("pg_safeupdate emulation", () => {
  it("detects an unfiltered UPDATE", () => {
    expect(unfilteredStatements("UPDATE _sr SET a = b;")).toHaveLength(1);
    expect(unfilteredStatements("UPDATE _sr SET a = b WHERE true;")).toHaveLength(0);
  });

  for (const f of sqlFiles(ROOT).filter((f) => !SUPERSEDED.has(f))) {
    it(`${f} has no UPDATE/DELETE without WHERE`, () => {
      expect(unfilteredStatements(readFileSync(join(ROOT, f), "utf8"))).toEqual([]);
    });
  }

  it("superseded 013 really had the two refused statements", () => {
    const s = readFileSync(join(ROOT, "phase2/013_xpm_batch_functions_policy.sql"), "utf8");
    expect(unfilteredStatements(s)).toHaveLength(2);
  });
});
