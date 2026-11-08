import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');
assert.match(source, /@version\s+1\.17\.278/);
const start = source.indexOf('function reorderGalleryToplistSections(root)');
assert.notEqual(start, -1, 'Gallery Toplists ordering helper exists');
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
assert.notEqual(end, -1, 'Gallery Toplists ordering helper is complete');

function card(label) {
  return {
    label,
    matches: (selector) => selector === '.tdo',
    querySelector: (selector) => selector === 'p' ? { textContent: `Galleries ${label}` } : null
  };
}

function extractFunction(name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `${name} helper exists`);
  const open = source.indexOf('{', functionStart);
  let braces = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') braces += 1;
    else if (source[index] === '}' && --braces === 0) return source.slice(functionStart, index + 1);
  }
  assert.fail(`${name} helper is complete`);
}

const heading = { textContent: 'Gallery Toplists' };
const cards = [card('All-Time'), card('Past Year'), card('Past Month'), card('Yesterday')];
const group = {
  children: [heading, ...cards],
  classList: { add(name) { this.value = name; } },
  appendChild(node) {
    this.children = this.children.filter((child) => child !== node);
    this.children.push(node);
    return node;
  }
};
heading.closest = (selector) => selector === '.dc' ? group : null;
const root = { querySelectorAll: (selector) => selector === 'h2' ? [heading] : [] };
const reorder = vm.runInNewContext(`(${source.slice(start, end)})`, { Array, String });

assert.equal(reorder(root), true, 'the Gallery Toplists group is recognized');
assert.deepEqual(
  group.children.filter((child) => child.matches?.('.tdo')).map((section) => section.label),
  ['Yesterday', 'Past Month', 'Past Year', 'All-Time'],
  'Gallery Toplists are ordered from Yesterday through All-Time'
);
assert.equal(group.classList.value, 'ehtw-gallery-toplists', 'only the Gallery Toplists group receives the cover style scope');
assert.match(source, /html\.ehtw-generic \.ehtw-gallery-toplists \.tdo img\.ehtw-gallery-toplist-cover\s*\{\s*display:\s*block !important/, 'injected Gallery Toplists covers are visible');
assert.match(source, /ehtw-gallery-toplists \.tdo \.tun\s*\{[\s\S]*?min-height:\s*60px !important[\s\S]*?overflow:\s*visible !important/, 'the native single-line title wrapper no longer clips the cover or title');
assert.match(source, /ehtw-gallery-toplists \.tdo \.tun > a\s*\{\s*display:\s*grid !important[\s\S]*?grid-template-columns:\s*44px minmax\(0, 1fr\)/, 'the cover and title use separate grid columns');
assert.match(source, /ehtw-gallery-toplists \.tdo table tr\s*\{\s*display:\s*flex !important/, 'rank number, cover, and title occupy one horizontal row');
assert.match(source, /const visibleEntries = filterToplistEntries\(entries, hiddenTags\)[\s\S]*?const displayEntries = visibleEntries\.slice\(0, 10\)/, 'Search sidebar uses the filtered top ten too');
assert.match(source, /reorderGalleryToplistSections\(content\)/, 'generic Toplists pages invoke the ordering transform');
assert.match(source, /publishToplistEntries\(href, entries\)/, 'the existing Yesterday and Month Toplists share their thumbnail data with the page');
assert.match(source, /past\\s\+year\|all\[\\s-\]\*time[\s\S]*?window\.fetch\(href/, 'missing Year and All-Time thumbnails load their matching Toplists once');
assert.match(source, /input\[id\^="taghide_"\][\s\S]*?tagpreview_[\s\S]*?normalizeHiddenTag/, 'hidden tags are read from checked My Tags hide controls');
assert.match(source, /tags:\s*getToplistEntryTags\(row\)/, 'Toplist gallery entries retain their tags for filtering across native layouts');
assert.match(source, /fetch\('\/mytags'[\s\S]*?getHiddenTagsFromMyTags/, 'Toplists reads hidden tags from the signed-in My Tags page');
assert.match(source, /ehtw-search-toplist-data-v5/, 'old cached entries without verified tags are discarded');
assert.match(source, /SEARCH_HIDDEN_TAGS_CACHE_TTL = 60 \* 1000/, 'a short session cache lets recently verified hidden-tag filters be reused');
assert.match(source, /if \(cachedHiddenTags\) \{\s*renderSection\(section, entries, cachedHiddenTags\);\s*hiddenTagsPromise\.then/, 'valid Toplist data paints from cache before My Tags refresh completes');
assert.match(source, /sections\.forEach\(\(section\) => \{ loadSection\(section\); \}\)/, 'Yesterday and Month Toplists load concurrently');
const searchPanelStart = source.indexOf('function makeSearchToplistPanel()');
const searchPanelEnd = source.indexOf('function buildSearch()', searchPanelStart);
assert.ok(searchPanelStart >= 0 && searchPanelEnd > searchPanelStart, 'search Toplist loader is isolated for latency checks');
assert.doesNotMatch(source.slice(searchPanelStart, searchPanelEnd), /setTimeout\(resolve, 500\)/, 'the artificial half-second gap between Toplists is removed');
assert.match(source, /function extractToplistEntries\(root, limit = 10\)/, 'Toplists can collect extra candidates for backfill');
assert.match(source, /const toplistEntryLimit = 50/, 'each period fetches fifty candidates for filtering and backfill');
assert.match(source, /filterToplistResultRows\(content, hiddenTags\)/, 'opening a period Toplist filters its gallery result grid too');
assert.match(source, /isToplistResultPage[\s\S]*?tweet\._ehtwToplistTags = entryTags[\s\S]*?requestHiddenMyTags\(\)/, 'the in-place Toplist result route removes galleries with hidden tags');

const imagesCreated = [];
const context = vm.createContext({
  Array,
  Map,
  URL,
  location: { origin: 'https://e-hentai.org', href: 'https://e-hentai.org/toplist.php' },
  document: {
    createElement(tag) {
      const image = { tagName: tag.toUpperCase(), setAttribute(name, value) { this[name] = value; } };
      imagesCreated.push(image);
      return image;
    },
    createTextNode(text) { return { textContent: text }; }
  }
});
vm.runInContext(
  `${extractFunction('normalizeHiddenTag')}\n${extractFunction('getHiddenTagsFromMyTags')}\n${extractFunction('getToplistEntryTags')}\n${extractFunction('filterToplistEntries')}\n${extractFunction('filterToplistResultRows')}\n${extractFunction('getToplistPageKey')}\n${extractFunction('renderGalleryToplistCovers')}\nglobalThis.readHiddenTags = getHiddenTagsFromMyTags; globalThis.readEntryTags = getToplistEntryTags; globalThis.filterEntries = filterToplistEntries; globalThis.filterResultRows = filterToplistResultRows; globalThis.renderCovers = renderGalleryToplistCovers;`,
  context
);

const myTagRows = [
  {
    querySelector(selector) {
      if (selector === 'input[id^="taghide_"]') return { checked: true };
      if (selector === '[id^="tagpreview_"]') return { title: 'female:blocked+tag', textContent: '', getAttribute(name) { return name === 'title' ? this.title : null; } };
      return null;
    }
  },
  {
    querySelector(selector) {
      if (selector === 'input[id^="taghide_"]') return { checked: false };
      if (selector === '[id^="tagpreview_"]') return { title: 'parody:visible', textContent: '', getAttribute(name) { return name === 'title' ? this.title : null; } };
      return null;
    }
  }
];
const hiddenTags = context.readHiddenTags({
  querySelector: () => null,
  querySelectorAll: () => myTagRows
});
assert.deepEqual(Array.from(hiddenTags), ['female:blocked tag'], 'checked My Tags hide values are normalized');
assert.deepEqual(
  Array.from(context.filterEntries([
    { title: 'blocked', tags: ['female:blocked_tag'] },
    { title: 'visible', tags: ['parody:visible'] }
  ], hiddenTags).map((entry) => entry.title)),
  ['visible'],
  'the shared filter removes blocked entries from the right Search sidebar too'
);
assert.deepEqual(
  Array.from(context.readEntryTags({
    querySelectorAll: () => [
      { getAttribute: () => 'Female:Blocked+Tag', textContent: 'blocked tag' },
      { getAttribute: () => 'language:english', textContent: 'English' }
    ]
  })),
  ['female:blocked tag', 'language:english'],
  'native toplist tags are normalized before matching'
);
const detailCell = (values) => ({
  hidden: false,
  classes: new Set(),
  querySelectorAll: () => values.map((value) => ({ getAttribute: () => value, textContent: value })),
  classList: { add(name) { this.owner.classes.add(name); }, owner: null }
});
const matchingCell = detailCell(['female:blocked_tag']);
matchingCell.classList.owner = matchingCell;
const safeCell = detailCell(['parody:visible']);
safeCell.classList.owner = safeCell;
assert.equal(context.filterResultRows({ querySelectorAll: () => [matchingCell, safeCell] }, hiddenTags), 1, 'period-list pages also remove galleries carrying a hidden tag');
assert.equal(matchingCell.hidden, true);
assert.equal(matchingCell.classes.has('ehtw-hidden-tag-gallery'), true);
assert.equal(safeCell.hidden, false);

function row(initialHref, rankNumber) {
  const rank = { textContent: `#${rankNumber}` };
  const link = {
    href: initialHref,
    children: [],
    getAttribute(name) { return name === 'href' ? this.href : null; },
    setAttribute(name, value) { if (name === 'href') this.href = value; },
    querySelector(selector) { return selector === '.ehtw-gallery-toplist-cover' ? this.children.find((child) => child.className === selector.slice(1)) : null; },
    replaceChildren(...children) { this.children = children; this.textContent = children.map((child) => child.textContent || '').join(''); }
  };
  return {
    hidden: false,
    link,
    rank,
    classList: { add(name) { this[name] = true; }, remove(name) { delete this[name]; } },
    querySelector(selector) {
      if (selector === 'td.pso') return rank;
      if (selector === 'a[href*="/g/"]') return link;
      return null;
    }
  };
}
const rows = [row('https://e-hentai.org/g/2222/token/', 1), row('https://e-hentai.org/g/1234/token/', 2)];
const coverGroup = { querySelectorAll: (selector) => selector === '.tdo tr' ? rows : [] };
const candidates = [
  { href: 'https://e-hentai.org/g/2222/token/', title: 'Hidden gallery', thumbnail: 'https://ehgt.org/thumb/blocked.jpg', tags: ['female:blocked_tag'] },
  { href: 'https://e-hentai.org/g/1234/token/', title: 'Visible gallery 1', thumbnail: 'https://ehgt.org/thumb/1234.jpg', tags: ['parody:visible'] },
  { href: 'https://e-hentai.org/g/3333/token/', title: 'Visible gallery 2', thumbnail: 'https://ehgt.org/thumb/3333.jpg', tags: ['language:english'] }
];
assert.equal(context.renderCovers(coverGroup, candidates, hiddenTags), 2, 'hidden entries are removed and the next eligible galleries backfill the visible rows');
assert.equal(rows.every((item) => !item.hidden), true, 'the two native visible rows are both filled');
assert.equal(rows[0].link.href, candidates[1].href, 'the hidden first result is replaced by the next eligible gallery');
assert.equal(rows[1].link.href, candidates[2].href, 'the following eligible gallery fills the second slot');
assert.deepEqual(rows.map((item) => item.rank.textContent), ['#1', '#2'], 'backfilled entries are compactly renumbered');
assert.equal(imagesCreated.length, 2);
assert.equal(rows[0].link.children[0].src, 'https://ehgt.org/thumb/1234.jpg');
assert.equal(rows[0].link.children[0].className, 'ehtw-gallery-toplist-cover');
assert.equal(rows[0].link.children[0].loading, 'lazy');

console.log('PASS Gallery Toplists load and show covers, ordered Yesterday, Month, Year, All-Time');
