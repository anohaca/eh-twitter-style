import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');
assert.match(source, /@version\s+1\.17\.278/);

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

const qs = (selector, node) => node?.querySelector?.(selector) || null;
const qsa = (selector, node) => node?.querySelectorAll?.(selector) || [];
const textOf = (node) => node?.textContent || '';
const findGalleryListLink = vm.runInNewContext(
  `(${extractDeclaration('findGalleryListLink')})`,
  { qs, qsa, textOf }
);
const isGalleryListRow = vm.runInNewContext(
  `(${extractDeclaration('isGalleryListRow')})`,
  { findGalleryListLink }
);

const galleryAnchor = (label, path) => ({
  textContent: label,
  getAttribute: (name) => name === 'href' ? path : null,
  querySelector: (selector) => selector === '.glink' && label ? { textContent: label } : null
});
const nativeRow = (anchors, thumbnail = false) => ({
  matches: (selector) => selector === '.gl1t' && thumbnail,
  querySelectorAll: (selector) => selector === 'a[href*="/g/"]' ? anchors : []
});

const cases = [
  ['Minimal', nativeRow([galleryAnchor('Minimal gallery', '/g/1/token/')])],
  ['Minimal+', nativeRow([galleryAnchor('Minimal+ gallery', '/g/2/token/')])],
  ['Compact', nativeRow([galleryAnchor('Compact gallery', '/g/3/token/')])],
  ['Extended', nativeRow([
    galleryAnchor('', '/g/4/token/'), // cover link appears before the title link
    galleryAnchor('Extended gallery', '/g/4/token/')
  ])],
  ['Thumbnail', nativeRow([galleryAnchor('Thumbnail gallery', '/g/5/token/')], true)]
];

for (const [mode, row] of cases) {
  assert.equal(isGalleryListRow(row), true, `${mode} rows are recognized`);
  const titleLink = findGalleryListLink(row);
  assert.ok(titleLink, `${mode} title link is found`);
  if (mode === 'Extended') assert.equal(titleLink.textContent, 'Extended gallery', 'Extended skips its empty cover link');
}

assert.match(source, /table\.itg\.gltc, table\.itg\.gltm, table\.itg\.glte, div\.itg\.gld/, 'all five native modes enter the list conversion pipeline');
assert.match(source, /const galleryLink = findGalleryListLink\(row\);[\s\S]*?const tweet = createTweet\(sourceRow\)/, 'native rows share the same card renderer');
assert.match(source, /\.gl1e img[\s\S]*?\.gl1m img/, 'cover lookup accounts for Extended and Minimal layouts');
assert.match(source, /\.ehtw-tweet-title a > div:not\(\.glink\):not\(\.gl4t\):not\(\.gl4e\):not\(\.glname\)/, 'gallery title wrappers survive the metadata overlay rule');
assert.match(source, /\.ehtw-tweet-title a > \.gl4e\.glname \{\s*display: block !important;[\s\S]*?min-height: 0 !important/, 'Extended mode title wrappers are visible and reset from native fixed heights');
assert.match(source, /\.ehtw-thumb-tweet \.ehtw-tweet-title \.gl4t \{\s*display: block !important;[\s\S]*?visibility: visible !important;/, 'Thumbnail card titles remain visible on narrow screens');

console.log('PASS five native gallery modes share one card conversion path');
