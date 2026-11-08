import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');
assert.match(source, /@version\s+1\.17\.277/);

function extractDeclaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} declaration is complete`);
}

const makeNav = (items) => ({
  querySelectorAll: () => items.map(({ text, href }) => ({
    textContent: text,
    href,
    getAttribute: (name) => name === 'href' ? href : null
  }))
});
const isNativeNavigationLoggedIn = vm.runInNewContext(
  `(${extractDeclaration('isNativeNavigationLoggedIn')})`,
  {}
);
const getNativeAccountActionUrl = vm.runInNewContext(
  `(${extractDeclaration('getNativeAccountActionUrl')})`,
  {}
);

assert.equal(isNativeNavigationLoggedIn(makeNav([{ text: 'My Tags', href: '/mytags' }])), true);
assert.equal(isNativeNavigationLoggedIn(makeNav([{ text: 'My Uploads', href: '/upld/manage' }])), true);
assert.equal(isNativeNavigationLoggedIn(makeNav([{ text: 'Login', href: 'https://forums.e-hentai.org/index.php?act=Login&CODE=00' }])), false);
assert.equal(getNativeAccountActionUrl(true), 'https://forums.e-hentai.org/index.php?act=Login&CODE=03');
assert.equal(getNativeAccountActionUrl(false), 'https://forums.e-hentai.org/index.php?act=Login&CODE=00');

assert.match(source, /account\.addEventListener\('click', toggleAccountMenu\)/, 'the whole account capsule opens the menu');
assert.match(source, /if \(accountMenu\.contains\(event\.target\)\) return/, 'menu actions do not bubble into the capsule toggle');
assert.match(source, /accountIsLoggedIn \? '退出登录' : '登录'/);
assert.match(source, /addSpaPageEventListener\(document, 'keydown',[\s\S]*?event\.key !== 'Escape'[\s\S]*?account\.focus\(\)/);
assert.match(source, /\.ehtw-account-menu\[hidden\]\s*\{\s*display:\s*none !important;/);
assert.doesNotMatch(source, /ehtw-mobile-brand/, 'the extra site-name label is removed');
assert.match(source, /const siteBrand = location\.hostname\.toLowerCase\(\) === 'exhentai\.org'[\s\S]*?\? 'ExHentai'[\s\S]*?:\s*'E-Hentai'[\s\S]*?brand\.textContent = siteBrand/, 'desktop keeps its E-Hentai or ExHentai title');
assert.match(source, /create\('div', 'ehtw-nav-entry ehtw-nav-mobile-extra ehtw-mobile-account-entry'\)[\s\S]*?mobileAccountLink\.href = getNativeAccountActionUrl\(accountIsLoggedIn\)[\s\S]*?accountIsLoggedIn \? '退出登录' : '登录'/, 'mobile More menu exposes the correct login/logout action');
assert.match(source, /followingLink\.appendChild\(makeIcon\(isFollowingFeedPage \? 'following-filled' : 'following'\)\)/, 'Following has a distinct icon from Watched');
assert.match(source, /mobileAccountLink\.appendChild\(makeIcon\(accountIsLoggedIn \? 'logout' : 'login'\)\)/, 'mobile authentication has distinct sign-in and sign-out icons');
assert.match(source, /html\.ehtw-enabled #ehtw-left #nb > \.ehtw-mobile-account-entry\s*\{\s*display: none !important;/, 'mobile auth row is hidden in desktop navigation so logout is not duplicated');
assert.match(source, /@media \(min-width: 700px\)[\s\S]*?html\.ehtw-exhentai #ehtw-left #nb > \.ehtw-more-entry\s*\{\s*display: none !important;/, 'redundant ExHentai desktop More control is hidden while capsule logout remains available');
assert.match(source, /\[\/\^settings\?\/i, 'settings'\]/, 'Settings has its own navigation icon mapping');
assert.match(source, /\[\/\^my\\s\*tags\?\/i, 'tag'\]/, 'My Tags has its own navigation icon mapping');
assert.match(source, /#ehtw-left:has\(#nb\.ehtw-nav-open\)\s*\{\s*height: auto !important;[\s\S]*?align-content: flex-start !important/, 'the mobile More panel grows to its content without blank space above');

console.log('PASS account capsule menu and mobile login/logout entry');
