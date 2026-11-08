# EH Twitter Style

E-Hentai / ExHentai userscript that provides a Twitter-style gallery feed and a mobile-friendly reader.

## Build

```sh
node tools/build.mjs
node tools/build-check.mjs
```

The readable source is `src/eh-twitter-style.user.src.js`; `eh-twitter-style_user.js` is the generated installable userscript.

## Offline tests

```sh
cd tests
npm ci
npx playwright install chromium webkit
npm test
```

The Playwright suite uses a local synthetic site. It does not contact E-Hentai or change account data.

## Live browser checks

`tools/test-all.mjs` and `tools/test-navigation-live.mjs` can run read-only checks through a locally enabled Chrome DevTools Protocol session. Live navigation makes ordinary page requests; account-changing actions are not part of the live suite.
