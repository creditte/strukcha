# Review & Improve: making long issue lists manageable

Today the page prints every issue for every structure in one endless column. A firm with hundreds of structures gets a scroll that never ends and no way to find anything. The fix is to turn the list into a short, filterable, page-by-page view.

## What the user will see

1. **Sticky toolbar under the header** that stays visible while scrolling:
   - Search box: filter by structure name or issue text.
   - Severity filters: All / Critical / Warning / Minor, each showing a count.
   - Sort: Most issues first, Critical first, or A–Z by name.

2. **One collapsed row per structure instead of every issue at once.**
   Each row shows the structure name, how many items it has, a critical count, and an "Open structure" button. Clicking the row expands its issues underneath. The first structure is expanded by default so the page never looks empty. An "Expand all / Collapse all" toggle sits in the toolbar.

3. **Paging instead of infinite scroll.** 20 structures per page with a simple "Showing 1–20 of 137" line plus Previous / Next and page numbers. Changing search, filter or sort resets to page 1.

4. **Long issue lists inside one structure are capped.** If a structure has more than 8 issues, show 8 with a "Show all 23 items" link that expands in place.

5. **Nothing-found state.** When search or filters exclude everything, show a short message with a "Clear filters" button rather than a blank page.

6. Duplicates tab keeps its current behaviour; only the Issues tab changes.

## Technical notes

- All work stays in `src/pages/Review.tsx` plus one new presentational component `src/components/review/StructureIssueGroup.tsx` (collapsible card built on the existing shadcn `Collapsible`, `Badge`, `Button`).
- No changes to `useClientHealthReview`, scoring, or any database call — the hook already returns the full issue set; filtering, sorting, grouping and slicing are done in a `useMemo` over `review.allIssues`.
- State added to the page: `query`, `severity`, `sort`, `page`, `expandedIds: Set<string>`.
- Severity counts come from the unfiltered issue list so the filter chips always show true totals.
- Styling uses existing semantic tokens and the current card/badge patterns, so both themes keep working.

## Out of scope

Server-side pagination, changes to how issues are detected or scored, and the Duplicates tab.
