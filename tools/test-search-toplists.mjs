import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');
function extractFunction(name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `${name} exists`);
  const functionBodyStart = source.indexOf('{', functionStart);
  let functionDepth = 0;
  for (let index = functionBodyStart; index < source.length; index += 1) {
    if (source[index] === '{') functionDepth += 1;
    else if (source[index] === '}' && --functionDepth === 0) return source.slice(functionStart, index + 1);
  }
  assert.fail(`${name} is complete`);
}
const normalizeHiddenTag = vm.runInNewContext(`(${extractFunction('normalizeHiddenTag')})`, {});
const getToplistEntryTags = vm.runInNewContext(
  `(${extractFunction('getToplistEntryTags')})`,
  { normalizeHiddenTag }
);
const filterToplistEntries = vm.runInNewContext(
  `(${extractFunction('filterToplistEntries')})`,
  { normalizeHiddenTag }
);
const nativeStart = source.indexOf('function extractNativeToplistEntries(');
const nativeBodyStart = source.indexOf('{', nativeStart);
let nativeDepth = 0;
let nativeEnd = -1;
for (let index = nativeBodyStart; index < source.length; index += 1) {
  if (source[index] === '{') nativeDepth += 1;
  else if (source[index] === '}' && --nativeDepth === 0) {
    nativeEnd = index + 1;
    break;
  }
}
assert.notEqual(nativeEnd, -1, 'shared native toplist parser is complete');
const start = source.indexOf('function extractToplistEntries(root, limit = 10)');
assert.notEqual(start, -1, 'toplist HTML parser exists');
const bodyStart = source.indexOf('{', start);
let depth = 0;
let end = -1;
for (let index = bodyStart; index < source.length; index += 1) {
  if (source[index] === '{') depth += 1;
  else if (source[index] === '}' && --depth === 0) {
    end = index + 1;
    break;
  }
}
assert.notEqual(end, -1, 'toplist HTML parser is complete');

function anchor(number, title, href = `/g/${number}/sample/`) {
  const textNode = { textContent: title };
  return {
    getAttribute: (name) => name === 'href' ? href : null,
      querySelector: (selector) => selector === '.glink' ? textNode : null
  };
}

function row(link, thumbnailUrl = '', thumbnailStyle = '') {
  const image = thumbnailUrl ? {
    getAttribute: (name) => name === 'data-src' ? thumbnailUrl : null
  } : null;
  return {
    matches: (selector) => selector === '.gl1t',
    querySelectorAll: (selector) => {
      if (selector === 'a[href*="/g/"]' || selector === 'a[href]') return [link];
      if (selector === '.gt') return [{ getAttribute: (name) => name === 'title' ? 'artist:test' : null, textContent: 'test' }];
      if (selector === '.glthumb img, .gl3t img, .gl1e img, .gl1m img, img') return image ? [image] : [];
      return [];
    },
    querySelector: (selector) => selector === '.glthumb, .gl5t, [style*="background"]' && thumbnailStyle
      ? { getAttribute: (name) => name === 'style' ? thumbnailStyle : null }
      : null,
    getAttribute: () => null
  };
}

const rows = Array.from({ length: 12 }, (_, index) =>
  row(anchor(index + 1, `Gallery ${index + 1}`), `/thumb/${index + 1}.jpg`)
);
rows[1] = row(anchor(1, 'Duplicate gallery'), '/thumb/duplicate.jpg');
rows[2] = row(anchor(99, 'External gallery', 'https://example.com/g/99/sample/'));
rows[3] = row(anchor(4, 'Gallery 4'), '', "background-image: url('/thumb/4-bg.webp')");
const sourceNode = {
  querySelectorAll: (selector) => selector === '.gl1t' ? rows : []
};
const root = {
  querySelector: () => sourceNode
};
const qs = (selector, node) => node?.querySelector(selector) || null;
const qsa = (selector, node) => node?.querySelectorAll(selector) || [];
const extractNativeToplistEntries = vm.runInNewContext(
  `(${source.slice(nativeStart, nativeEnd)})`,
  { getToplistEntryTags: () => ['artist:test'], location: { href: 'https://e-hentai.org/toplist.php?tl=13' }, URL }
);
const extractToplistEntries = vm.runInNewContext(
  `(${source.slice(start, end)})`,
  { extractNativeToplistEntries, location: { origin: 'https://e-hentai.org', href: 'https://e-hentai.org/toplist.php?tl=13' } }
);

const entries = extractToplistEntries(root);
assert.equal(entries.length, 10, 'the panel shows at most ten entries');
assert.equal(entries[0].title, 'Gallery 1', 'gallery title is read from the native link');
assert.equal(entries[0].href, 'https://e-hentai.org/g/1/sample/');
assert.equal(entries[0].thumbnail, 'https://e-hentai.org/thumb/1.jpg', 'lazy thumbnail URL is resolved');
assert.deepEqual(Array.from(entries[0].tags), ['artist:test'], 'native tag metadata is retained for My Tags filtering');
assert.equal(entries[1].title, 'Gallery 4', 'duplicate and off-site gallery links are skipped');
assert.equal(entries[1].thumbnail, 'https://e-hentai.org/thumb/4-bg.webp', 'inline background thumbnail is resolved');
assert.equal(new Set(entries.map((entry) => entry.href)).size, 10, 'gallery entries are unique');
const hiddenTagRow = {
  querySelectorAll: (selector) => selector === '.gt'
    ? [{ getAttribute: (name) => name === 'title' ? 'other:ai_generated' : null, textContent: 'AI Generated' }]
    : []
};
const hiddenTags = getToplistEntryTags(hiddenTagRow);
assert.deepEqual(Array.from(hiddenTags), ['other:ai generated'], 'native gallery tags normalize to the same keys as My Tags');
assert.deepEqual(
  Array.from(filterToplistEntries([
    { title: 'blocked AI gallery', tags: hiddenTags },
    { title: 'visible gallery', tags: ['artist:test'] }
  ], new Set(['other:ai generated'])).map((entry) => entry.title)),
  ['visible gallery'],
  'hidden tags remove matching Toplist entries before the sidebar renders them'
);
assert.deepEqual(Array.from(entries[0].tags), ['artist:test'], 'tag metadata survives native-row extraction for filtering');
const extendedRows = Array.from({ length: 15 }, (_, index) =>
  row(anchor(index + 100, `Extended Gallery ${index + 1}`), `/thumb/extended-${index + 1}.jpg`)
);
assert.equal(
  extractToplistEntries({ querySelector: () => ({ querySelectorAll: (selector) => selector === '.gl1t' ? extendedRows : [] }) }, 50).length,
  15,
  'Toplists overview can retain more candidates than the sidebar ten-item preview'
);
assert.doesNotMatch(source, /^\/\/ @noframes$/m, 'the userscript can run in its isolated E-Hentai toplist bridge frame');
assert.match(source, /type: 'ehtw-toplist-bridge', token, period, entries[\s\S]*?\}, 'https:\/\/exhentai\.org'\)/, 'the E-Hentai frame returns parsed public toplist data to ExHentai');
assert.match(source, /const CACHE_KEY = 'ehtw-search-toplist-data-v5'[\s\S]*?cachedTagsAreComplete[\s\S]*?Array\.isArray\(entry\?\.tags\)/, 'old toplist caches without tag data are discarded before display');
assert.match(source, /if \(!hiddenTagState\.tags\)[\s\S]*?Could not apply hidden tag filters/, 'the sidebar never silently displays an unfiltered toplist when My Tags cannot load');
assert.match(source, /location\.hostname\.toLowerCase\(\) === 'exhentai\.org' && !hasNativeToplists[\s\S]*?toplistsLink\.href = 'https:\/\/e-hentai\.org\/toplist\.php'/, 'ExHentai gets a Toplists navigation link to the available native page');

console.log('PASS Search Toplists parse and render up to ten unique native gallery links');
