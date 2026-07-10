# Task 4 Report: Browser Hardening, Deployment Handoff, and Local Preview

## Changed Files

- `src/App.tsx`: loads the generated Census place index as a same-origin Vite URL asset after initial render; preserves researched suggestions during loading/failure; closes autocomplete after selection, Escape, and clear; adds concise methodology/geography attribution.
- `src/components/UsMap.tsx`: adds visual legend shape swatches and an accessible Lucide reset icon with a native title tooltip.
- `src/styles.css`: corrects table, summary, badge, and mobile-list status semantics; styles loading/error feedback, legend swatches, footer, and reduced-motion behavior.
- `tests/app-shell.test.tsx`: covers deferred place-index loading/failure and autocomplete close-on-selection behavior.
- `tests/map.test.tsx`: covers legend swatches and the icon-only reset control.
- `vitest.config.ts`: restricts Vitest to `tests/` and uses a single controlled fork for stable `npm test` runs.
- `package.json`, `package-lock.json`: adds Playwright and `npm run test:e2e`.
- `playwright.config.ts`, `e2e/dashboard.spec.ts`: production-preview browser coverage for desktop/mobile, map/table/search interactions, color semantics, keyboard access, screenshots, console errors, and runtime request origin.
- `docs/deployment.md`: build, Nginx, deployment, cache, ownership, and refresh instructions.

## TDD Evidence

- Red: deferred-index and legend/reset tests failed because the app eagerly imported the index and the map had neither swatches nor an icon reset control.
- Green: `npm test -- tests/app-shell.test.tsx tests/map.test.tsx` passed 22 tests after the minimal implementation.
- Red: the browser suite found that an open autocomplete list intercepted map controls after a selection.
- Green: a focused app-shell test failed, then passed after selections, Escape, and clear closed the listbox while typing/focus reopened it.

## Verification

- `npm test`: passed, 4 files and 49 tests, using one Vitest fork.
- `npm run lint`: passed with no lint output.
- `npm run build`: passed. Initial application JavaScript is `430.20 kB` (`134.26 kB` gzip); the place index is emitted separately as `dist/assets/usPlaces-BxsTEMak.json` at `3,892.27 kB` (`667.83 kB` gzip) and fetched same-origin after initial render.
- `npm run test:e2e`: passed, 5 Playwright tests against `vite preview` at `127.0.0.1:4173`. Chromium was installed with `npx playwright install chromium`.
- Browser assertions verify no console errors and no cross-origin runtime requests.

## Screenshot Artifacts

- `test-results/dashboard-renders-the-comp-46299-t-initial-counts-and-colors/desktop-1440x900.png`
- `test-results/dashboard-mobile-layout-ke-30f0a-ipping-and-captures-the-map/mobile-390x844.png`

Both were visually inspected: the compact header, controls, map, legend, footer, and essential text fit without viewport overflow or clipping.

## Commit

- Task 4 commit SHA: pending final commit.

## Self-Review

- The place index is no longer part of the initial JavaScript chunk. It remains a deployable local static asset rather than an external service request.
- Researched-city search stays responsive while the index loads or fails; Census-only results wait for the successful index response.
- Status color semantics are consistent across badges, summary/table/mobile treatments, and marker shapes/colors: qualified green, high CPC red, unknown CPC yellow/triangle, low volume blue/square, and no-data gray.
- The footer and deployment guide attribute the 2025 Places Gazetteer and the researched Woodbridge/Edison county-subdivision fallbacks.
- Playwright covers both semantic interaction and layout evidence at 1440x900 and 390x844.

## Concerns

- The deployment must preserve every generated file under `dist/assets/`, including the hashed Census index JSON, or unresearched suggestions will show the intentional non-blocking unavailable state.
- `npm install` reported 5 dependency audit findings (3 moderate, 1 high, 1 critical); no automated remediation was applied because it would be unrelated dependency churn.
