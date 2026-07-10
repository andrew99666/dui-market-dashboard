# Task 4 Report: Browser Hardening, Deployment Handoff, and Local Preview

## Changed Files

- `src/App.tsx`: loads the generated Census place index as a same-origin Vite URL asset after initial render; preserves researched suggestions during loading/failure; closes autocomplete after selection and clear; gives Escape a non-destructive close-only path; adds roving keyboard navigation for dashboard tabs; adds concise methodology/geography attribution.
- `src/components/UsMap.tsx`: adds visual legend shape swatches and an accessible Lucide reset icon with a native title tooltip.
- `src/styles.css`: corrects table, summary, badge, and mobile-list status semantics; styles loading/error feedback, legend swatches, footer, and reduced-motion behavior.
- `tests/app-shell.test.tsx`: covers deferred place-index loading/failure, autocomplete close-on-selection/Escape preservation, and roving tab navigation.
- `tests/dashboard-domain.test.ts`: covers researched-market precedence and Census city/state de-duplication.
- `tests/map.test.tsx`: covers legend swatches, the icon-only reset control, and focused-tooltip positioning after zoom.
- `vitest.config.ts`: restricts Vitest to `tests/` and uses a single controlled fork for stable `npm test` runs.
- `package.json`, `package-lock.json`: adds Playwright and `npm run test:e2e`.
- `playwright.config.ts`, `e2e/dashboard.spec.ts`, `e2e/dashboard.spec.ts-snapshots/*.png`: production-preview browser coverage for a configured 1440x900 desktop and 390x844 mobile viewport, map/table/search interactions, visual baselines, color semantics, keyboard access, console errors, and runtime request origin.
- `docs/deployment.md`: build, Nginx, deployment, cache, ownership, and refresh instructions.

## TDD Evidence

- Red: deferred-index and legend/reset tests failed because the app eagerly imported the index and the map had neither swatches nor an icon reset control.
- Green: `npm test -- tests/app-shell.test.tsx tests/map.test.tsx` passed 22 tests after the minimal implementation.
- Red: the browser suite found that an open autocomplete list intercepted map controls after a selection.
- Green: a focused app-shell test failed, then passed after selections, Escape, and clear closed the listbox while typing/focus reopened it.
- Review red: Escape cleared the query, selected spotlight, filters, and page; tab buttons lacked roving `tabIndex` and ArrowLeft/ArrowRight/Home/End handling. Focused unit tests failed with the expected cleared state and missing `tabindex` values.
- Review green: Escape now only closes the listbox and clears its active descendant, while the roving tablist moves focus and selects the corresponding panel.
- Review red: the desktop Playwright assertion received the default `1280x720` viewport instead of `1440x900`; after adding visual assertions, Playwright also failed because the desktop baseline PNG was absent.
- Review green: the configured desktop viewport is asserted as `1440x900`; `--update-snapshots` generated both committed PNG baselines and a normal browser run compared them successfully.
- Final review red: identical Census city/state labels could shadow a researched market, and a focused marker used untransformed projection coordinates for its tooltip.
- Final review green: Census-only matches now collapse by normalized city/state and never duplicate a researched city/state; focus tooltips derive their position from the current pan/zoom transform.
- Final review coverage: Census-only Springfield records in Illinois and Massachusetts remain separate, while hover tooltips remain pointer-anchored after zoom.

## Verification

- `npm test`: passed, 4 files and 55 tests, using one Vitest fork.
- `npm run lint`: passed with no lint output.
- `npm run build`: passed. Initial application JavaScript is `430.99 kB` (`134.59 kB` gzip); the place index is emitted separately as `dist/assets/usPlaces-BxsTEMak.json` at `3,892.27 kB` (`667.83 kB` gzip) and fetched same-origin after initial render.
- `npm run test:e2e`: passed, 6 Playwright tests against `vite preview` at `127.0.0.1:4173`, with an asserted `1440x900` desktop viewport and a `390x844` mobile override. Chromium was installed with `npx playwright install chromium`.
- Browser assertions verify no console errors and no cross-origin runtime requests.

## Visual Baselines

- `e2e/dashboard.spec.ts-snapshots/dashboard-desktop-win32.png` (1440x900)
- `e2e/dashboard.spec.ts-snapshots/dashboard-mobile-win32.png` (390x844)

Both are committed Playwright `toHaveScreenshot` baselines. Tests wait for the place index, disable animations, hide carets, and assert no viewport overflow before comparing the desktop or mobile presentation.

## Commit

- Task 4 commit SHA: pending final commit.
- Review remediation commit SHA: pending final commit.

## Self-Review

- The place index is no longer part of the initial JavaScript chunk. It remains a deployable local static asset rather than an external service request.
- Researched-city search stays responsive while the index loads or fails; Census-only results wait for the successful index response.
- Status color semantics are consistent across badges, summary/table/mobile treatments, and marker shapes/colors: qualified green, high CPC red, unknown CPC yellow/triangle, low volume blue/square, and no-data gray.
- The footer and deployment guide attribute the 2025 Places Gazetteer and the researched Woodbridge/Edison county-subdivision fallbacks.
- Playwright covers both semantic interaction and layout evidence at 1440x900 and 390x844.
- Escape leaves query, spotlight, state/status filters, and pagination untouched while closing only autocomplete state.
- Dashboard tabs now follow the expected roving-focus behavior for ArrowLeft, ArrowRight, Home, and End.
- Search preserves distinct same-name cities in different states while removing visually identical Census alternatives that would otherwise compete with a researched market.
- Keyboard-focused map tooltips use the selected marker's rendered, transformed SVG position.

## Concerns

- The deployment must preserve every generated file under `dist/assets/`, including the hashed Census index JSON, or unresearched suggestions will show the intentional non-blocking unavailable state.
- The committed visual baselines target Playwright's Windows renderer (`*-win32.png`); a non-Windows CI runner needs an approved renderer-specific baseline or a standardized Windows test environment.
- `npm install` reported 5 dependency audit findings (3 moderate, 1 high, 1 critical); no automated remediation was applied because it would be unrelated dependency churn.
