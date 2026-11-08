# Continuous Reader Implementation Plan

> **For agentic workers:** Native implementation in this session; execute test-first.

**Goal:** Turn original E-Hentai `/s/` pages into a pure-black continuous image reader with adjustable progressive preloading, gapless scroll mode, one-image click mode, and a current/total page indicator.

**Architecture:** Keep the current `/s/` image node, move it into a minimal reader root, and hide the original page chrome. Follow original same-origin `#prev` and `#next` links in separate sequential queues. Start each image request as soon as its URL is discovered so image downloads overlap with later page parsing; append downward images immediately and insert upward images in order after discovery. Preserve the opened page's viewport position while inserting earlier pages.

**Tech Stack:** Existing userscript JavaScript, browser DOM APIs, same-origin Fetch, `IntersectionObserver`, Node.js CDP test harness.

**Spec:** `docs/superpowers/specs/2026-11-01-continuous-reader-design.md` (approved 2026-11-01).

## Global Constraints

- Only recognized image pages under `/s/` are enhanced; list/detail pages remain unchanged.
- The visible reader contains the image strip and reading settings only; background is `#000`.
- Default mode is gapless continuous vertical scrolling; optional click mode shows one image and advances through the same original page sequence.
- Let the user set preload batch size from 1–50, default 3; continue as the user approaches the strip end.
- Save preload count, reading mode, and zoom percentage locally and restore them on subsequent reader pages.
- Build a bounded-concurrency in-memory map of gallery page numbers to `/s/` URLs from the gallery's thumbnail index pages.
- Clicking the image center toggles both top settings and bottom page tools.
- Start each image request as soon as its URL is discovered, allowing downloads to overlap later page parsing.
- Show current/total page count; track viewport-centered page in scroll mode and the active image in click mode.
- Use only original same-origin `/s/` pages and image URLs referenced by those pages; do not use `innerHTML` or cookies. `localStorage` holds only the preload count; do not store reading mode or progress.
- Prevent duplicate/repeated URLs, boundary self-links, and overlapping batch requests; on failure leave loaded images usable.
- When opening a middle page, preload earlier images above and later images below, in original sequence.

## Review Focus

- A gallery with 1,998 pages must not issue requests for all pages at once.
- A terminal `#next` self-link must stop the queue without duplicating the final image.
- Failed page or image loads must not hide already loaded pages or the mode controls.
- Show an icon-only retry button in the center of a failed image; refetch its source page metadata and replace only that image without navigating or refreshing the reader page.
- Show a rotating loading indicator for pending images; hide it after load or error.
- Click mode must display exactly one image and honor previous/next boundaries; center clicks must toggle settings.
- In click mode, mouse wheel advances pages; while zoomed, wheel scrolls vertically until reaching the image edge.
- Bottom zoom and page tools overlay images in both modes; click mode fits to the full viewport behind the toolbars, and the page slider seeks loaded and not-yet-loaded pages.
- During slider dragging, immediately preview already loaded pages and coalesce sequential page discovery for unloaded targets; release commits the final target.
- While waiting for an unloaded seek target, hide the old image and show a centered loading indicator; reveal the target after its page metadata is ready.
- For a seek outside the loaded preload range, resolve the target `/s/` link from the gallery thumbnail index and fetch that page directly; don't wait for intervening page links. After selecting it, resume nearby preloads from that page.
- Zoom buttons and manual percentage input work in both modes without enabling horizontal dragging.
- The configured preload count must control the next batch, with image resources starting in parallel.
- A pending or failed image resource must not hold the page-discovery queue or later preload batches.
- Page indicator must update while scrolling, when switching modes, and after click-mode advancement.
- Images must cancel native drag start; touch action remains vertical-only.
- Mobile settings controls must be legible, touch-sized, fit the device viewport, and stay clear of the first image.
- On mobile, prioritize the current and nearest next image, lower priority for distant preloads, and release decoded image resources far outside the reading area; restore them when revisited.
- Defer mobile neighbor image requests until the main document load completes so eager preloads do not hold the browser's navigation progress.
- Non-reader pages must retain their existing layout and behavior.

### Task 1: Build continuous `/s/` reader

**Files:**
- Modify: `eh-twitter-style.user.js`
- Modify: `tools/test-reader.mjs`
- Modify: `tools/test-reader-browser.mjs`
- Create: `tools/test-reader-backward-browser.mjs`
- Create: `tools/test-reader-mobile.mjs`

- [x] Extend the real-browser test to assert pure-black background, image/settings-only layout, zero gap, configurable batch size, parallel image loading, one-image click mode, center-to-toggle settings, and continued loading after scrolling.
- [x] Run the CDP test and confirm it fails on the current single-image reader.
- [x] Implement page-shell hiding, gapless image strip, adjustable sequential page parsing, parallel image loading per batch, one-image click mode, and center-to-toggle settings.
- [x] Add a current/total page indicator that follows the viewport-centered image or the active click-mode image.
- [x] Run the CDP reader test and local fixture; verify first/last page and progressive image loading.
- [x] Add a real CDP test for a middle page, bidirectional order, current-page viewport preservation, click-back traversal, and upward continuation.
- [x] Run JavaScript syntax checks and existing list/detail CDP regression tests.

## Execution Notes

- RED: the extended CDP test failed on the prior single-image reader because no future images entered the strip.
- GREEN: real `/s/` first-page test confirms pure-black background, only controls plus image stream visible, three future image files fully loaded, and another three fully loaded when scrolling to the end.
- GREEN: real `/s/` last-page test confirms no duplicate preload and no next-page navigation beyond the last image.
- GREEN: `node tools/test-reader.mjs` passes all seven local behavior checks; syntax checks pass for the userscript and both reader test files.
- Regression: real list/detail checks report no JavaScript errors or document-level horizontal overflow. The latest `/popular` mobile probe reports one internally overflowing hashtag; detail-page probes report existing internal column spill.
- GREEN: CDP test sets preload count to 2, verifies subsequent two-image batches, advances through loaded images in one-image click mode, and confirms center-click hides/restores settings.
- GREEN: switching from scroll mode to click mode preserves the image at the viewport center; returning to scroll mode reveals the full strip.
- GREEN: the click-mode test advances to the end of its loaded batch, loads the next configured batch, and still shows exactly one image.
- GREEN: real `/s/` page shows `1 / 1998`, updates to `6 / 1998` while scrolling and `2 / 1998` while clicking; the final page shows `1998 / 1998`.
- GREEN: local and CDP checks confirm images cancel native drag start and computed touch action is `pan-y`.
- GREEN: 390px mobile CDP layout check confirms larger mode buttons, page count, and preload input fit without horizontal overflow and do not overlap the first image.
- GREEN: local checks confirm failed images are detected both at startup and after an error event, show an icon-only retry button, refresh stale image URLs, and retry without page navigation.
- RED→GREEN: CDP intercepted and held page 2's image request; subsequent image resources and later batches still loaded, confirming one stalled image cannot block the sequence.
- RED→GREEN: real mid-gallery CDP test first failed on the forward-only reader, then passed with ordered previous and next batches, current-page position preserved, local click-back, and upward continuation to the start.
- GREEN: a stalled image keeps its loading spinner visible while later images and subsequent preload batches complete; loaded or failed images hide the spinner.
- GREEN: CDP held the third page metadata response and confirmed the first two next-page images had already entered the strip and started their downloads before the held response was released.
- GREEN: mobile CDP confirms nearest-next image priority, low-priority distant preloads, image resource release outside the reading area, and reload when scrolling back.
- GREEN: mobile CDP confirms neighboring images receive no `src` until the main document's `load` event, then start requests.
- Regression fix: after preserving the viewport while inserting earlier pages, the scroll handler still refreshes the current-page indicator while suppressing only artificial batch triggers.
- Follow-up requirements from the user—an editable preload count, zero image gap, concurrent image requests, one-image click mode, and center-click settings visibility—are included in the approved design and implemented.
- Resilience: a scroll listener supplements `IntersectionObserver`; if a small-image batch leaves the sentinel within view it fills the visible area, while limiting automatic fill batches to avoid runaway requests.
- Final check: the latest 390px mobile settings test and list/detail regression pass; the latest list probe has no overflow, while the detail probe retains an existing internal column spill.
- Final review: author self-review; no subagent review used, per user's preference.
