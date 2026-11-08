import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');

assert.match(source, /const MY_HOME_PATH_PATTERN = \/\^.*home\\\.php.*mytags/, 'My Home account routes receive a dedicated layout class');
const homePatternSource = source.match(/const MY_HOME_PATH_PATTERN = (\/.*\/i);/)?.[1];
assert.ok(homePatternSource, 'My Home subpage matcher exists');
const isMyHomePath = vm.runInNewContext(homePatternSource);
for (const path of ['/home.php', '/mytags', '/stats.php', '/uconfig.php', '/hentaiathome.php', '/bitcoin.php', '/hathperks.php', '/exchange.php', '/logs.php']) {
  assert.equal(isMyHomePath.test(path), true, `${path} receives My Home layout`);
}
assert.equal(isMyHomePath.test('/'), false, 'front page does not receive the My Home layout');
assert.match(source, /@match\s+https:\/\/upld\.e-hentai\.org\/manage\*/, 'My Uploads manager pages are included by userscript matching');
assert.match(source, /@match\s+https:\/\/upld\.e-hentai\.org\/bounty_post\.php\*/, 'bounty posting pages on the upload host are included');
assert.match(source, /@match\s+https:\/\/upld\.exhentai\.org\/upld\/\*/, 'ExHentai My Uploads routes are included by userscript matching');
assert.match(source, /const isMyUploadsPage = isUploadSiteOrigin\(location\.origin\)/, 'both upload hosts receive the dedicated layout class');
const uploadOriginFunction = source.match(/function isUploadSiteOrigin\(value = location\.origin\) \{[\s\S]*?\n    \}/)?.[0];
assert.ok(uploadOriginFunction, 'upload origin detector exists');
const isUploadSiteOrigin = vm.runInNewContext(`(${uploadOriginFunction})`, {
  EHTW_UPLOAD_ORIGINS: new Set(['https://upld.e-hentai.org', 'https://upld.exhentai.org'])
});
assert.equal(isUploadSiteOrigin('https://upld.e-hentai.org'), true);
assert.equal(isUploadSiteOrigin('https://upld.exhentai.org'), true);
assert.equal(isUploadSiteOrigin('https://exhentai.org'), false);
assert.match(source, /const isBountyPage = .*bounty/, 'Bounties has a route-specific page class');
assert.match(source, /html\.ehtw-bounty #ehtw-center \.ehtw-generic-content table\.itg > tbody > tr:not\(:first-child\) \{[\s\S]*?display: grid !important;/, 'Bounty entries become compact responsive cards');
assert.match(source, /html\.ehtw-bounty #ehtw-center \.ehtw-generic-content #searchform \{[\s\S]*?flex-direction: column !important;/, 'Bounty filters fit the content column');
assert.match(source, /html\.ehtw-bounty #ehtw-center \.ehtw-generic-content #t > \.d1 \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.25fr\) minmax\(0, 1fr\)/, 'Most Wanted cards size both reward-image columns to the center pane');
assert.match(source, /#t > \.d1 > \.d2 img,[\s\S]*?width: 100% !important;[\s\S]*?object-fit: contain !important;/, 'Most Wanted reward images scale without clipping');
assert.match(source, /@media \(max-width: 699px\) \{[\s\S]*?html\.ehtw-bounty #ehtw-center \.ehtw-generic-content #t > \.d1 > \.d3 \{\s*display: contents !important;/, 'Most Wanted images and details reflow into rows on phones');
assert.match(source, /if \(isMyHomePage\) \{\s*document\.documentElement\.classList\.add\('ehtw-myhome'\)/, 'account pages are marked before styles are applied');
assert.match(source, /html\.ehtw-myhome #ehtw-center \.ehtw-generic-content \.stuffbox,[\s\S]*?\.logbox,[\s\S]*?min-width: 0 !important;[\s\S]*?background: var\(--ehtw-card\)/, 'all My Home stuffbox and logbox panels fit the center column and use the theme surface');
assert.match(source, /:is\(\.stuffbox, \.logbox, #outer\) form \{[\s\S]*?max-width: 100% !important/, 'fixed-width My Home forms are constrained to their card');
assert.match(source, /'\/hentaiathome\.php': 'Hentai@Home'/, 'Hentai@Home gets a page-specific heading');
assert.match(source, /pathname === '\/exchange\.php'[\s\S]*?Hath Exchange[\s\S]*?GP Exchange/, 'exchange tabs get page-specific headings');
assert.match(source, /pathname === '\/logs\.php'[\s\S]*?Credit Log[\s\S]*?Karma Log/, 'account logs get page-specific headings');
assert.match(source, /html\.ehtw-mytags #ehtw-center #usertags_outer > div \{[\s\S]*?display: grid !important;[\s\S]*?grid-template-columns:/, 'My Tags controls are rearranged into responsive rows');
assert.match(source, /#usertags_outer > div > div:first-child \{\s*display: flex !important;[\s\S]*?text-align: left !important;/, 'tag names remain left-aligned inside their responsive row');
assert.match(source, /@media \(max-width: 799px\) \{[\s\S]*?html\.ehtw-mytags #ehtw-center #usertags_outer > div \{[\s\S]*?grid-template-rows: auto auto auto/, 'My Tags rows compact before the My Home center column becomes too narrow');

console.log('PASS My Home and My Tags responsive layout rules');
