import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');

const expandedKeyStart = source.indexOf('function getGalleryGridExpandedStorageKey(');
assert.notEqual(expandedKeyStart, -1, 'gallery grid expansion gets a per-gallery storage key');
const expandedKeyBodyStart = source.indexOf('{', expandedKeyStart);
let expandedKeyDepth = 0;
let expandedKeyEnd = -1;
for (let i = expandedKeyBodyStart; i < source.length; i++) {
  if (source[i] === '{') expandedKeyDepth++;
  else if (source[i] === '}' && --expandedKeyDepth === 0) {
    expandedKeyEnd = i + 1;
    break;
  }
}
assert.notEqual(expandedKeyEnd, -1, 'gallery grid storage key helper is complete');
const getGalleryGridExpandedStorageKey = vm.runInNewContext(
  `(${source.slice(expandedKeyStart, expandedKeyEnd)})`,
  {}
);
assert.equal(
  getGalleryGridExpandedStorageKey('/g/123/abcd/'),
  'ehtw-gallery-grid-expanded-v1:123',
  'grid expansion key is scoped to a gallery id'
);
assert.equal(
  getGalleryGridExpandedStorageKey('/g/456/efgh/'),
  'ehtw-gallery-grid-expanded-v1:456',
  'different galleries do not share expanded state'
);
assert.equal(getGalleryGridExpandedStorageKey('/mytags'), null, 'non-gallery pages have no expanded-state key');
const functionStart = source.indexOf('function findNextGalleryThumbPageUrl(');
assert.notEqual(functionStart, -1, 'gallery thumbnail page resolver exists');
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
assert.notEqual(functionEnd, -1, 'gallery thumbnail page resolver is complete');

class Link {
  constructor(href, label = '') {
    this.href = href;
    this.textContent = label;
    this.attrs = { href };
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
}

class Pager {
  constructor(links) { this.links = links; }
  querySelectorAll(selector) { return selector === 'a[href]' ? this.links : []; }
}

const location = {
  href: 'https://e-hentai.org/g/123/abcd/',
  origin: 'https://e-hentai.org'
};
const qsa = (selector, root) => Array.from(root?.querySelectorAll(selector) || []);
const textOf = (node) => node?.textContent?.trim() || '';
const findNextGalleryThumbPageUrl = vm.runInNewContext(
  `(${source.slice(functionStart, functionEnd)})`,
  { URL, location, qsa, textOf }
);

assert.equal(
  findNextGalleryThumbPageUrl(new Pager([
    new Link('https://e-hentai.org/g/123/abcd/?p=0', '1'),
    new Link('https://e-hentai.org/g/123/abcd/?p=2', '3'),
    new Link('https://e-hentai.org/g/123/abcd/?p=1', '2')
  ])),
  'https://e-hentai.org/g/123/abcd/?p=1',
  'the first gallery page chooses the next page index'
);

assert.equal(
  findNextGalleryThumbPageUrl(
    new Pager([
      new Link('https://e-hentai.org/g/123/abcd/?p=1', '2'),
      new Link('https://e-hentai.org/g/123/abcd/?p=2', '>')
    ]),
    'https://e-hentai.org/g/123/abcd/?p=1'
  ),
  'https://e-hentai.org/g/123/abcd/?p=2',
  'later gallery pages continue from their current p index'
);

assert.equal(
  findNextGalleryThumbPageUrl(new Pager([
    new Link('https://example.com/g/123/abcd/?p=1', 'Next')
  ])),
  null,
  'gallery page resolver rejects links from other origins'
);

assert.match(source, /remaining <= threshold\) loadNextGalleryThumbPage\(\)/, 'the gallery strip fetches another batch near its right edge');
assert.match(source, /gdt\.insertBefore\(link, continuationStatus\)/, 'new thumbnails are appended before the edge status control');
assert.match(source, /startGalleryStripContinuation\(\)/, 'gallery strip continuation starts after reader setup');
assert.match(source, /if \(pager\) setStyleSafe\(pager, 'display', 'none'\)/, 'gallery pagination is hidden when automatic continuation is available');
assert.match(source, /ehtw-gallery-grid-expanded \.ehtw-gallery-pagination:not\(\.ehtw-gallery-pagination-secondary\)[\s\S]*?display: block !important/, 'expanded image grids reveal page links for direct navigation');
assert.match(source, /ehtw-gallery-pagination-secondary[\s\S]*?display: none !important/, 'duplicate lower pagination stays hidden when expanded');
assert.match(source, /'Images'[\s\S]*?ehtw-gallery-grid-expanded/, 'the image section can expand into a grid');
assert.match(source, /let checkGalleryStripEdge = \(\) => \{\};[\s\S]*?expandImagesButton\.addEventListener\('click',[\s\S]*?checkGalleryStripEdge\(\)[\s\S]*?checkGalleryStripEdge = \(\) => \{/, 'image expansion is safe when a gallery has no additional thumbnail pages to preload');
assert.match(source, /const updateTagExpandVisibility = \(\) => \{[\s\S]*?tagList\.scrollHeight > 112[\s\S]*?expandButton\.hidden = false[\s\S]*?expandButton\.hidden = true/, 'tag expand visibility follows actual wrapped content height');
assert.match(source, /scheduleTagExpandVisibilityUpdate\(\);[\s\S]*?addSpaPageEventListener\(\s*window,[\s\S]*?'resize'/, 'tag overflow is rechecked after layout and viewport width changes and cleaned on SPA route changes');
assert.match(source, /@media \(max-width: 699px\) \{[\s\S]*?ehtw-detail-tags #taglist \.gt[\s\S]*?white-space: normal !important;[\s\S]*?overflow-wrap: anywhere !important;/, 'long mobile tags wrap inside the available screen width');
assert.match(source, /ehtw-detail-tags-collapsed #taglist[\s\S]*?max-height: 112px/, 'long tag lists start collapsed');
assert.match(source, /const expandButton = create\([\s\S]*?'ehtw-detail-expand-button'[\s\S]*?expandButton\.type = 'button';[\s\S]*?expandButton\.addEventListener\('click', \(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/, 'tag expand button cannot submit a surrounding form or trigger an outer click handler');
assert.match(source, /if \(section\.classList\.contains\('ehtw-gallery-grid-expanded'\)\) return/, 'expanded image grids do not auto-load additional pages');
assert.match(source, /ehtw-gallery-grid-expanded \.ehtw-gallery-continuation[\s\S]*?display: none !important/, 'expanded grids hide the continuation control');

console.log('PASS gallery thumbnail pagination and edge continuation');
