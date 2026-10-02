# Eliminate endless scrolling in Health and Review

## Goal
Keep every Health Check and Review view short, predictable, and easy to navigate, even for firms with thousands of structures or duplicate groups.

## User experience

1. **Review & Improve — Issues**
   - Reduce each page from 20 to 10 collapsed structure rows.
   - Keep only one structure expanded at a time by default.
   - Replace “Show all” inside a structure with pagination of its issues, so expanding a large structure never creates a very long page.
   - Keep the search, severity filters, sort order, page count, and previous/next controls visible and predictable.
   - Return the user to the top of the results when changing pages or filters.

2. **Review & Improve — Duplicates**
   - Add search and confidence filters.
   - Show 10 duplicate groups per page instead of rendering every group at once.
   - Add clear result counts and previous/next page controls.
   - Keep merge and dismiss actions on the current group without losing the user’s page unnecessarily.

3. **Structure Health — All structures**
   - Add search, status filtering, and sorting in the list header.
   - Show 15 structures per page with result counts and previous/next controls.
   - Reset to page one when filters change and return to the list top after page navigation.

4. **Key insights**
   - Show a short initial set of insights and provide contained pagination when there are more.
   - Avoid any “Show all” action that expands the page indefinitely.

## Technical details

- Use client-side pagination over the already-loaded health dataset; no additional backend requests are required.
- Keep page, filter, and expansion state local to each view.
- Reuse existing Button, Input, Select, Badge, and Card components and semantic colour tokens.
- Add a small shared pagination control only if it removes duplication cleanly; otherwise keep focused controls in each screen.
- Preserve existing health scoring, duplicate detection, merge/dismiss behaviour, and navigation.
- Verify TypeScript, empty/filter states, first/last-page boundaries, and desktop/mobile layouts.

## Acceptance checks

- No list renders more than its stated page size.
- Expanding one structure cannot expose an unbounded issue list.
- Issues, duplicate groups, structures, and insights all have bounded presentation.
- Filtering after visiting a later page never produces an empty or invalid page.
- Merge, dismiss, open-structure, retry, and status-filter actions continue to work.
