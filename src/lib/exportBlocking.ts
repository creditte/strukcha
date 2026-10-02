import type { ScoringIssue } from "@/lib/structureScoring";

/**
 * Single source of truth for which health issues block export.
 * Only genuine structural contradictions block; missing/incomplete facts never do.
 */
export const EXPORT_BLOCKING_ISSUE_CODES: ReadonlySet<string> = new Set([
  "invalid_relationship_direction",
  "circular_ownership",
  "ownership_exceeds",
  "multiple_trades_as_owners",
]);

export function isExportBlockingIssue(issue: Pick<ScoringIssue, "code">): boolean {
  return EXPORT_BLOCKING_ISSUE_CODES.has(issue.code);
}

export interface ExportBlockResult {
  blocked: boolean;
  blockingIssues: ScoringIssue[];
}

export function getExportBlock(
  issues: ScoringIssue[] | undefined,
  blockOnCriticalSetting: boolean | undefined,
): ExportBlockResult {
  if (!blockOnCriticalSetting || !issues) return { blocked: false, blockingIssues: [] };
  const blockingIssues = issues.filter(isExportBlockingIssue);
  return { blocked: blockingIssues.length > 0, blockingIssues };
}
