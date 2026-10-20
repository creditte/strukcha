# Firm-wide fix: why XPM diagrams are wrong (S Dart Group is one example)

**Scope across the firm (live data):** 42 clients are stored as Sole Trader, in 26 diagrams; 21 of them have XPM relationships that were rejected or held for review. About 34,000 evidence rows exist, many repeated across runs. Every fix below applies to all groups, and S Dart is used only as the test case.

## What I found (checked against the live data)

**1. The diagram is almost empty because Stephen Dart is stored as a "Sole Trader".**
XPM sends 12 kinds of relationships for Stephen (Director, Secretary, Shareholder, Trustee, Beneficiary, Member, Spouse). Our relationship rules don't allow a Sole Trader to be any of those, so every one was rejected or held for review:
- Director, Secretary, Member, Spouse → rejected as invalid
- Shareholder → waiting for a "Trades As" owner that doesn't exist
- Trustee, Beneficiary → held for review

The result: Stephen, Amanda and SAXR Investments have **0 relationships**. Only 2 links exist in the whole diagram (SAXR Dart Pty Ltd trustee of the SMSF, and a hand-made Dart Family Trust → Dart Financial Services shareholding). In reality Stephen is a person who also trades as a business. The XPM type mapping turns any client whose XPM type mentions "sole trader" into a Sole Trader, losing the person.

**2. Health Check is reporting the gap honestly.** "No director recorded", "has no relationships", "No Trades As owner" all follow directly from point 1. The red "Conflicting data" is the Trust shown as a shareholder directly (shares are held by the trustee, not the trust). Health is not wrong — the data is.

**3. Evidence is duplicated.** 238 evidence rows for this group's 7 clients across 10 runs, 56 with no duplicate-check key. Every preview/apply adds more rows, so the review queue grows each time.

**4. "Apply and open" loop.** Every preview finds no real change except "hand-made relationship kept", so Apply does nothing (backend log: 0 added, 0 removed) and the same dialog appears again whenever Open in Editor or the breadcrumb is used. The exact reason the page doesn't move on after Apply is not yet confirmed and is the first thing to reproduce.

## Fix

1. **Reproduce the Open-in-Editor loop** in the browser (signed in) from both the Structures list and the group page breadcrumb; fix navigation so Apply always opens the diagram, and skip the dialog entirely when there is nothing to change (open directly).
2. **Treat XPM "sole trader" clients as a person who trades as a business.** Keep the person as an Individual (so Director / Shareholder / Spouse / Trustee / Beneficiary attach to them), and only create a separate Sole Trader business with one Trades As link when XPM really describes a business. Re-check existing Sole Trader clients that have person-type relationships.
3. **Re-check every affected group firm-wide using the facts already saved.** No new XPM read is needed. Rejected or held relationships are decided again under the corrected type. You get one firm-wide preview (per group: what would be added), and nothing is applied until you confirm.
4. **Stop duplicate evidence**: fill in the missing duplicate-check keys and make each preview/apply reuse existing rows instead of adding new ones; collapse existing duplicates for review.
5. **Trust-as-shareholder**: offer a one-click fix in Review ("move shareholding to trustee SAXR Dart Pty Ltd / Stephen Dart") rather than leaving it a hard conflict.
6. Apply the same trustee fix suggestion to every diagram where a trust is shown holding shares directly, then re-run Health for all affected diagrams. You'll get a before/after report.

## Safety
No XPM sync, no changes to client or relationship data, and nothing applied to other groups without your explicit go-ahead. Manual edits and diagram positions are kept.

## Technical details
- Type mapping: `supabase/functions/_shared/xpm-entity-type.ts` (`/sole trader/` → `"Sole Trader"`); policy via `xpm-policy-normalise.ts` + `relationship-policy.ts` (unchanged rules; the input type is what changes). Parity tests and `bun run test:sql` must stay green.
- Re-evaluation: re-run `relationship_policy_evaluate` over `relationship_import_evidence` rows with `review/invalid/resolve_sole_trader` outcomes for the corrected entities; write via existing bridge RPCs with `contract: 'canonical_v1'`.
- Dedupe: backfill `dedupe_key`; uniqueness constraint is staged in `pending-migrations/phase2/010` — activate after backfill.
- Dialog: `Structures.tsx` `handleConfirmXpmImport` / `GroupStructureViewer.tsx`; use `isNoopPlan` to bypass the dialog.
