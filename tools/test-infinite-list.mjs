import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');
const functionStart = source.indexOf('function findNextListPageUrl(');
assert.notEqual(functionStart, -1, 'list pagination URL resolver exists');
const bodyStart = source.indexOf('{', functionStart);
let depth = 0;
let functionEnd = -1;
for (let i = bodyStart; i < source.length; i++) {
  if (source[i] === '{') depth++;
  else if (source[i] === '}' && --depth === 0) {
    functionEnd = i + 1;
    break;
  }
}
assert.notEqual(functionEnd, -1, 'list pagination URL resolver is complete');

class Link {
  constructor(href, label = '', attrs = {}) {
    this.href = href;
    this.textContent = label;
    this.attrs = { href, ...attrs };
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
}

class Root {
  constructor({ direct = null, links = [] } = {}) {
    this.direct = direct;
    this.links = links;
  }
  querySelector(selector) {
    return selector === '#dnext, a[rel~="next"]' ? this.direct : null;
  }
  querySelectorAll(selector) {
    return selector === '.searchnav a[href]' ? this.links : [];
  }
}

const location = {
  href: 'https://e-hentai.org/?page=2&f_search=cat',
  origin: 'https://e-hentai.org'
};
const qs = (selector, root) => root?.querySelector(selector) || null;
const qsa = (selector, root) => Array.from(root?.querySelectorAll(selector) || []);
const textOf = (node) => node?.textContent?.trim() || '';
const findNextListPageUrl = vm.runInNewContext(
  `(${source.slice(functionStart, functionEnd)})`,
  { URL, location, qs, qsa, textOf }
);

assert.equal(
  findNextListPageUrl(new Root({
    direct: new Link('/?next=cursor-3', 'Next')
  })),
  'https://e-hentai.org/?next=cursor-3',
  'direct next-page links are followed'
);

assert.equal(
  findNextListPageUrl(new Root({
    links: [
      new Link('/?page=1&f_search=cat', '1'),
      new Link('/?page=4&f_search=cat', '4'),
      new Link('/?page=3&f_search=cat', '3')
    ]
  })),
  'https://e-hentai.org/?page=3&f_search=cat',
  'numbered pagination chooses the closest following page'
);

assert.equal(
  findNextListPageUrl(new Root({
    links: [new Link('https://example.com/?page=3', 'Next')]
  })),
  null,
  'pagination links from another origin are ignored'
);

assert.match(source, /new window\.IntersectionObserver\([\s\S]*?rootMargin: '1000px 0px'/, 'list continuation loads before the sentinel reaches the viewport');
assert.match(source, /registerAdditionalStatsTweets\?\.\(appendedTweets\)/, 'appended galleries register with the existing rate-limited stats queue');
assert.match(source, /ehtw-list-pagination-hidden/, 'the original bottom page controls are hidden');
assert.match(source, /qsa\('#dnext, #unext'\)\.forEach/, 'native next and previous list links are hidden');
assert.match(source, /startListInfiniteContinuation\(\)/, 'the continuation observer starts after the layout is committed');
assert.match(source, /appendListRows\(nextTable, true\)/, 'next-page gallery entries are converted and appended to the existing timeline');
assert.match(source, /const isPopularTimelinePage = pathname === '\/popular'[\s\S]*?const renderPopularTimeline = \(\) => \{[\s\S]*?popularTimelineItems\.sort\(\(a, b\) =>\s*b\.timestamp - a\.timestamp \|\| a\.sequence - b\.sequence/, 'Popular cards are sorted newest first across the accumulated timeline');
assert.match(source, /if \(isPopularTimelinePage\) \{\s*popularTimelineItems\.push\([\s\S]*?renderPopularTimeline\(\)/, 'Popular pagination batches are merged into and rerendered through the date-sorted timeline');
assert.match(source, /const anchorCard = existingCards\.find\([\s\S]*?const anchorTop = anchorCard\?\.getBoundingClientRect\(\)\.top[\s\S]*?window\.scrollTo\?\.\(window\.scrollX \|\| 0, \(window\.scrollY \|\| 0\) \+ shift\)/, 'newer items inserted before the viewport keep the current reading card in place');
assert.match(source, /if \(!skipTransactionTracking\) \{\s*modifications\.push\(\{\s*type: 'attribute',[\s\S]*?cell\.removeAttribute\(name\)/, 'infinite-page clones do not leak rollback records');
assert.match(source, /if \(isList && table\?\.isConnected\) \{\s*table\.remove\(\);\s*table = null;/, 'successful list conversion removes the source table after conversion');
assert.match(source, /publishSpaPageCleanup\(\(\) => rollback\?\.\(\)\)/, 'successful list conversion retains its rollback journal for clean SPA route replacement');
console.log('PASS infinite-list URL selection and continuation safeguards');
