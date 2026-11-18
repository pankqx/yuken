# Agent guidance

## Project

- This is a static, browser based application. It uses plain HTML, CSS and JavaScript modules; there is no build step.
- `index.html` is the entry point. App behavior lives in `js/`, styles in `css/app.css`, and bundled browser libraries in `vendor/`.
- The app stores its data locally in IndexedDB through `js/db.js` and `js/store-local.js`.

## Making changes

- Keep changes compatible with the existing no-build ES module setup and offline use. Do not add a runtime or package dependency for routine app behavior.
- Shared dispatch rules and derived box totals belong in `js/common.js`; scanned label normalization belongs in `js/parse.js`; persistence belongs in `js/store-local.js`.
- Treat `totalWeight` as derived from all box label weights unless a user explicitly enters a weighbridge override (`weightEntered`). Recompute derived totals when saving dispatch changes.
- Preserve existing role checks, audit logging, duplicate checks, and offline behavior when changing dispatch flows.
- Escape user-provided values before inserting them into HTML, following the existing `esc` helpers.
- Keep user-facing labels and number/date formatting consistent with the existing Indian locale conventions.

## Verification

- For changes to browser behavior, inspect the affected flow and check JavaScript syntax or run the existing project validation command if one is available.
- Do not introduce generated bundles or modify vendored libraries for application-level fixes.
