# Task 3 Report: Interactive D3 U.S. Map

## Changed files

- `src/App.tsx`: replaced the placeholder with the controlled map and connected marker selection to the shared spotlight/search state.
- `src/components/UsMap.tsx`: added the D3 `geoAlbersUsa` and bundled `us-atlas` TopoJSON map, marker shapes/scaling, tooltip, zoom/pan/reset, legend filters, and no-data marker behavior.
- `src/components/MapPlaceholder.tsx`: removed the replaced placeholder.
- `src/styles.css`: added responsive map, legend, marker, tooltip, and focus styles.
- `tests/map.test.tsx`: added map geometry, markers, status shapes/toggles, tooltip/keyboard, search focus/no-data, reset, Alaska/Hawaii, and external URL coverage.
- `tests/app-shell.test.tsx`: added shared-search-to-map integration coverage.

## TDD evidence

- Red: `npm test -- tests/map.test.tsx` initially failed because `src/components/UsMap.tsx` did not exist.
- Green: map component tests passed after implementation.
- Red: the final accessible-label test failed with `Unable to find ... Toggle high cpc markers` while the component exposed the hyphenated label.
- Green: the component label was updated and the single-fork suite passed.

## Verification

- `npx vitest run --pool=forks --poolOptions.forks.singleFork=true`: 4 files passed, 42 tests passed.
- `npm run lint`: passed with no warnings or errors.
- `npm run build`: passed.
- `git diff --check`: no whitespace errors before the implementation commit.

## Commits

- `b4e67d7` - `feat: add interactive U.S. opportunity map`
- This report and the final accessible-label adjustment are committed immediately after this report is written.

## Self-review

- State rendering filters the bundled TopoJSON to 50 states plus D.C.; Alaska and Hawaii remain in the `geoAlbersUsa` projection.
- All 345 researched records render when every legend category is visible; marker category ordering keeps qualified markers on top.
- Selection state remains controlled by `App`, so search, table, map, and spotlight selections remain synchronized across tabs.
- Projection values are memoized by selected coordinates to avoid repeat transform updates.
- Tooltips clamp within the SVG viewBox; missing projection points are skipped rather than crashing.

## Concerns

- Vite reports a production JavaScript chunk above 500 kB because bundled U.S. topology is included in the application bundle. The build succeeds; code splitting would be a separate performance task.

## Review Follow-up

- Removed the root SVG `role="img"`; the surrounding labelled map region now owns the map label without making nested marker buttons presentational.
- Made the selected no-data marker focusable and added focus, blur, and pointer tooltip handling.
- Added assertions for nonblank state paths, hover tooltip dismissal and clamping, exposed marker button semantics, and numeric 4x transform centering.
- Red evidence: the new focused map run failed on the root image role, missing viewport transform hook, and missing no-data `tabIndex`.
- Green evidence: `npx vitest run --pool=forks --poolOptions.forks.singleFork=true` passed 45 tests; `npm run lint` and `npm run build` passed; `git diff --check` found no whitespace errors.
