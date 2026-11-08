# Original Reader Modes Implementation Plan

> **For agentic workers:** Native implementation in this session; execute test-first.

**Goal:** Add a vertical-scroll default and optional click-to-page mode to original E-Hentai `/s/` pages.

**Architecture:** Add a narrow `/s/` route handler before the script's existing exclusion. It styles the current full-size image for vertical scrolling and adds an ephemeral mode toggle; click paging uses original previous/next links already present in the document. No gallery-wide preloading or added requests.

**Tech Stack:** Existing standalone JavaScript userscript; Node.js built-in `node:test`/`assert` and a minimal DOM fixture.

**Spec:** Approved in conversation on 2026-11-01: modify original `/s/` pages, default vertical scrolling, optional click-to-page, only the current `/s/` image, no additional requests.

## Global Constraints

- Keep all pages other than recognized `/s/` reader pages unchanged.
- Preserve the original image and navigation nodes; create only the mode control and stylesheet.
- Do not use network requests, external assets, `innerHTML`, cookies, or storage.
- Missing page images or previous/next links must be handled without throwing.

## Review Focus

- A reader page missing either navigation link must still initialize and the available direction must work.
- A click on an image in vertical mode must not navigate.
- An unsupported `/s/` page must continue to be left untouched.
- Clicking the mode control must not trigger image paging.
- Existing detail/list transformations must remain unchanged.

### Task 1: Add `/s/` reader mode

**Files:**
- Modify: `eh-twitter-style.user.js`
- Create: `tools/test-reader.mjs`

- [x] Write a failing local fixture test for default vertical mode, mode toggle, previous/next click behavior, and missing navigation links.
- [x] Run `node tools/test-reader.mjs` and confirm the expected reader assertions fail.
- [x] Add the route-limited reader branch and styling to `eh-twitter-style.user.js`.
- [x] Re-run the fixture test and syntax-check the full userscript with `node --check eh-twitter-style.user.js`.
- [x] Run the local reader regression fixture, syntax checks, and CDP browser checks on real `/s/`, list, and detail pages.

## Execution Notes

- RED: `node tools/test-reader.mjs` failed because the original `/s/` route did not add `ehtw-reader`.
- RED: after adding a boundary-page case, the fixture exposed a self-link reload on the first page.
- RED: the first real CDP click showed that original page-level handlers still advanced from vertical mode despite `preventDefault()`.
- GREEN: `node tools/test-reader.mjs` passes all seven reader checks; syntax checks pass for the userscript and both reader test files.
- GREEN: `node tools/test-reader-browser.mjs` passes on a real `/s/` page, confirming vertical mode suppresses image navigation, first-page self-links do not reload, and the right click zone follows the original next link.
- Regression: `node tools/test-userscript.mjs` on `/popular` and a detail page reports no runtime errors or horizontal overflow. It does report internal detail-column spill in existing detail content.
- Browser inspection confirmed the live page exposes `#img` and duplicate `#prev`/`#next` links; the image itself is wrapped by a next-page link.
- Final review: one Minor finding deferred — the `#i3 img` fallback selector is not included in the image sizing rule. The observed live site uses `#img`.
