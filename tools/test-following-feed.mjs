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
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  assert.fail(`${name} declaration is complete`);
}

const normalizeCreatorFollowTag = vm.runInNewContext(
  `(${extractDeclaration('normalizeCreatorFollowTag')})`,
  {}
);
const getWatchedCreatorTagsFromMyTags = vm.runInNewContext(
  `(${extractDeclaration('getWatchedCreatorTagsFromMyTags')})`,
  { normalizeCreatorFollowTag }
);

assert.equal(normalizeCreatorFollowTag('artist:Foo_Bar'), 'artist:foo bar');
assert.equal(normalizeCreatorFollowTag('group:Club+Name'), 'group:club name');
const isCreatorTagValue = vm.runInNewContext(
  `(${extractDeclaration('isCreatorTagValue')})`,
  {}
);
assert.equal(isCreatorTagValue('/tag/group:circle+name'), true);
assert.equal(isCreatorTagValue('language:english'), false);

const row = (tag, watched) => ({
  querySelector(selector) {
    if (selector.startsWith('input[')) return { checked: watched };
    if (selector.startsWith('[id^="tagpreview_"]')) {
      return tag ? { getAttribute: () => tag, textContent: tag } : null;
    }
    return null;
  }
});
const page = {
  querySelector(selector) {
    return selector === '#tagset_enable' ? { checked: true } : null;
  },
  querySelectorAll() {
    return [
      row('artist:Foo_Bar', true),
      row('group:Circle_Name', true),
      row('artist:Skipped', false),
      row('male:yaoi', true)
    ];
  }
};

assert.deepEqual(
  Array.from(getWatchedCreatorTagsFromMyTags(page)),
  ['artist:foo bar', 'group:circle name'],
  'only watched artist and group tags become feed subscriptions'
);
const disabledTagSet = {
  querySelector: () => ({ checked: false }),
  querySelectorAll: () => [row('artist:Ignored', true)]
};
assert.equal(
  getWatchedCreatorTagsFromMyTags(disabledTagSet).size,
  0,
  'disabled My Tags sets do not contribute subscriptions'
);

const normalizeUploaderName = vm.runInNewContext(
  `(${extractDeclaration('normalizeUploaderName')})`,
  {}
);
const extractFavoriteGalleryPaths = vm.runInNewContext(
  `(${extractDeclaration('extractFavoriteGalleryPaths')})`,
  { window: { location: { origin: 'https://e-hentai.org' } }, URL }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(extractFavoriteGalleryPaths({
    querySelectorAll(selector) {
      assert.equal(selector, 'table.itg.gltc a[href], table.itg.gltm a[href], table.itg.glte a[href], div.itg.gld a[href]');
      return [
        { getAttribute: () => '/g/123/abcdef/' },
        { getAttribute: () => 'https://e-hentai.org/g/456/123abc/' },
        { getAttribute: () => '/favorites.php?favcat=9' },
        { getAttribute: () => 'https://example.com/g/789/abcdef/' },
        { getAttribute: () => '/g/123/abcdef/' }
      ];
    }
  }))),
  ['/g/123/abcdef/', '/g/456/123abc/'],
  'the dedicated favorites reader keeps unique same-origin gallery paths only'
);
const findFollowUploaderFavoriteNextUrl = vm.runInNewContext(
  `(${extractDeclaration('findFollowUploaderFavoriteNextUrl')})`,
  {
    FOLLOW_UPLOADERS_FAVCAT: 9,
    window: { location: { href: 'https://e-hentai.org/favorites.php?favcat=9' } },
    URL
  }
);
assert.equal(
  findFollowUploaderFavoriteNextUrl({
    querySelector(selector) {
      assert.equal(selector, '#dnext[href], a[rel~="next"][href]');
      return null; // E-Hentai's #dnext placeholder is a span without href.
    },
    querySelectorAll: () => [
      { getAttribute: () => '/favorites.php?favcat=9&page=2' },
      { getAttribute: () => '/favorites.php?favcat=1&page=1' },
      { getAttribute: () => '/favorites.php?favcat=9&page=1' }
    ]
  }, 'https://e-hentai.org/favorites.php?favcat=9'),
  'https://e-hentai.org/favorites.php?favcat=9&page=1',
  'favorite pagination ignores the href-less dnext placeholder and chooses the next page in this folder'
);
assert.equal(
  findFollowUploaderFavoriteNextUrl({
    querySelector: () => null,
    querySelectorAll: () => []
  }, 'https://e-hentai.org/favorites.php?favcat=9'),
  null,
  'a one-page favorites folder does not invent a follow-up URL'
);
const getWatchedUploaderEntriesFromMyTags = vm.runInNewContext(
  `(${extractDeclaration('getWatchedUploaderEntriesFromMyTags')})`,
  { normalizeUploaderName }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Array.from(getWatchedUploaderEntriesFromMyTags({
    querySelector: () => ({ checked: true }),
    querySelectorAll: () => [
      row('uploader:Uploader_Name', true),
      row('uploader:Skipped', false),
      row('artist:NotUploader', true)
    ]
  })))),
  [{ key: 'uploader name', name: 'Uploader_Name', href: '/uploader/Uploader_Name' }],
  'only watched uploader tags in My Tags become uploader subscriptions'
);

assert.match(source, /\/watched\?ehtw_following=authors/, 'following feed has a separate navigation route');
assert.match(source, /requestWatchedMyTagsPage\(\)\.then\(getWatchedCreatorTagsFromMyTags\)/, 'feed subscriptions come from watched artist/group tags in My Tags');
assert.match(source, /const followedAuthorTagsPromise = \(async \(\) =>/, 'native followed state is loaded on normal author search pages too');
assert.match(source, /Promise\.all\(\[followedAuthorTagsPromise, followedUploaderNamesPromise\]\)\.then\(\(\) => \{[\s\S]*?updateCardModeration\(tweet/, 'normal list cards update Follow and uploader states after My Tags loads');
assert.match(source, /\^\(\?:artist\|group\):/i, 'non-artist and non-group tags are excluded');
assert.match(source, /function getCardCreatorTags\(tweet, stats\)/, 'feed filtering reads creator tags from the visible card links');
assert.match(source, /cardCreatorTags\.some\(\(tag\) =>[\s\S]*?followedAuthorTags\.has\(tag\)/, 'feed cards are matched against the followed artist/group set');
assert.match(source, /html\.ehtw-list #ehtw-center \.ehtw-tweet\.ehtw-following-hidden\s*\{\s*display: none !important;/, 'hidden-card CSS outranks list-card display:grid rules');
assert.match(source, /tweet\.style\.setProperty\('display', 'none', 'important'\)/, 'non-followed cards receive inline important hiding');
assert.match(source, /visibleTags = isFollowingAuthorsPage[\s\S]*?isCreatorTagValue\(href\)/, 'Following Authors cards hide non-artist/group tag chips');
assert.match(source, /if \(isFollowingAuthorsPage && !isCreatorTagValue\(tagTitle\)\)/, 'Following Authors trending only collects artist/group tags');
assert.doesNotMatch(source, /create\('section', 'ehtw-following-intro'\)/, 'Following Authors has no intro prompt card');
assert.match(source, /const requestUrl = new URL\(source\.url, location\.href\)\.href;[\s\S]*?fetchUrl\.searchParams\.set\([\s\S]*?'_ehtw_refresh'[\s\S]*?window\.fetch\(fetchUrl\.href/, 'followed creators are fetched from absolute tag or uploader URLs with a unique cache key');
assert.match(source, /followingNextPageUrls\.set\(source\.key, nextUrl\)/, 'the feed remembers each followed creator or uploader page cursor');
assert.match(source, /findNextListPageUrl\(page, requestedUrl\)/, 'creator pagination advances using each tag page next link');
assert.match(source, /rootMargin: '6000px 0px'[\s\S]*?maybeLoadFollowingMore\(\)/, 'Following Authors starts the next creator batch well before reaching the bottom');
assert.match(source, /addSpaPageEventListener\(window, 'scroll', listInfiniteScrollFallback, \{ passive: true \}\)/, 'Follow continuation scroll listeners can be cleaned before SPA route changes');
assert.match(source, /const FOLLOWING_CREATOR_FETCH_CONCURRENCY = 3;/, 'follow batches use bounded parallel requests');
assert.match(source, /Promise\.all\(requestBatch\.map\(async \(\[sourceKey, requestedUrl, source\]\)/, 'pages for up to three followed sources are fetched in parallel');
assert.match(source, /const newTweets = \[\];[\s\S]*?newTweets\.push\(\.\.\.collectFollowingPage\([\s\S]*?source\?\.uploaderName \|\| ''[\s\S]*?if \(newTweets\.length\) renderFollowingTimeline\(newTweets\)/, 'each parallel batch merges and sorts creator or uploader cards together');
assert.match(source, /tweet\._ehtwFollowingSourceTag = normalizedSourceTag;[\s\S]*?tweet\.classList\.remove\('ehtw-following-checking'\)/, 'Follow cards are shown immediately without waiting on individual stats fetches');
assert.match(source, /if \(isFollowingAuthorsPage && sourceTag\) return \[sourceTag\]/, 'the followed source tag confirms Follow feed membership immediately');
assert.match(source, /const fragment = document\.createDocumentFragment\(\);[\s\S]*?fragment\.appendChild\(tweet\);[\s\S]*?timeline\.insertBefore\(fragment, infiniteStatus\)/, 'sorted feed cards are committed as one DOM fragment');
assert.match(source, /let startFollowingAuthorContinuation = null;/, 'Follow pagination callback is declared before list initialization');
assert.match(source, /const converted = isFollowingFeedPage\s*\? 0\s*: appendListRows\(table\)\.length/, 'native Watched cards are excluded from both custom follow feeds');
assert.match(source, /followingTimelineItems\.sort\(\(a, b\) =>\s*b\.timestamp - a\.timestamp/, 'creator result pages are merged newest first');
assert.match(source, /timestamp: timestamp \|\| 0/, 'missing timestamps do not get an artificial newest timestamp');
assert.match(source, /const requestUrl = new URL\(source\.url, location\.href\)\.href;[\s\S]*?fetchUrl\.searchParams\.set\([\s\S]*?source\.key[\s\S]*?cache: 'reload'/, 'initial creator feed requests bypass stale tag-page cache');
assert.match(source, /requestBatch\.map\(async \(\[sourceKey, requestedUrl, source\]\)[\s\S]*?fetchUrl\.searchParams\.set\([\s\S]*?sourceKey[\s\S]*?cache: 'reload'/, 'creator pagination bypasses stale tag-page cache too');
assert.match(source, /dataset\.ehtwScriptVersion = '1\.17\.277'/, 'running userscript version is exposed in the document for diagnostics');
assert.match(source, /function makeSearchToplistPanel\(\)[\s\S]*?const isExhentaiToplistHost = location\.origin === 'https:\/\/exhentai\.org'[\s\S]*?loadToplistThroughBridge/, 'ExHentai Search gets the same toplists through the E-Hentai bridge');
assert.match(source, /event\.origin !== 'https:\/\/e-hentai\.org'[\s\S]*?event\.source !== frame\.contentWindow[\s\S]*?payload\.token !== token/, 'cross-origin toplist bridge validates origin, source and token');
assert.match(source, /html\.ehtw-enabled #ehtw-right\.ehtw-toplist-only-sidebar[\s\S]*?:not\(#ehtw-search-card\):not\(\.ehtw-right-search\)[\s\S]*?display: none !important/, 'Search sidebars show only Search and its Toplists on both gallery sites');
assert.match(source, /if \(right\?\.classList\.contains\('ehtw-toplist-only-sidebar'\)\) return/, 'extra Trending and footer cards are not built beside the Toplists');
assert.match(source, /const CACHE_KEY = 'ehtw-search-toplist-data-v5'[\s\S]*?cachedTagsAreComplete[\s\S]*?Array\.isArray\(entry\?\.tags\)/, 'Toplist data is refetched when the previous cache predates tag filtering');
assert.match(source, /if \(isToplistResultPage\) \{\s*addClassSafe\(timeline, 'ehtw-toplist-filter-pending'\)/, 'Toplist result cards stay hidden until My Tags filters are ready');
assert.match(source, /Could not load My Tags filters\. Reload to retry\./, 'a failed hidden-tag fetch does not silently reveal unfiltered Toplist results');
assert.match(source, /fetchUrl\.searchParams\.set\(\s*'_ehtw_refresh',[\s\S]*?window\.fetch\(fetchUrl\.href/, 'initial creator fetches get a unique server-cache key');
assert.match(source, /fetchUrl\.searchParams\.set\(\s*'_ehtw_refresh',[\s\S]*?window\.fetch\(fetchUrl\.href/, 'creator pagination gets a unique server-cache key');
assert.match(source, /const liveRow = document\.importNode\(row, true\);[\s\S]*?createTweet\(liveRow\)[\s\S]*?followingSeenGalleryPaths\.add\(key\)/, 'fetched gallery rows are imported into the live document before conversion and deduplicated only after conversion succeeds');
assert.match(source, /if \(isFollowingFeedPage\) return;/, 'native Watched pagination does not append unrelated cards to custom feeds');
assert.doesNotMatch(source, /create\(\s*'a',\s*'ehtw-composer'/, 'front page has no post composer card');
assert.doesNotMatch(source, /\['Popular',\s*'\/popular',\s*'\/popular'/, 'Popular is removed from every top-tab row');
assert.doesNotMatch(source, /\['Following Authors',\s*'\/watched\?ehtw_following=authors'/, 'Following Authors is not shown in the top tabs');
assert.match(source, /#ehtw-header\.ehtw-tabs-header\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'two remaining top tabs fill the header');
assert.match(source, /@media \(max-width: 699px\) \{\s*html\.ehtw-enabled \.ehtw-search-toplists\s*\{\s*display: none !important;/, 'phone layout hides the toplist panel');
assert.match(source, /\[\/\^popular\/i, 'flame'\]/, 'left navigation keeps its Popular icon');
assert.match(source, /Month Toplist/);
assert.match(source, /Yesterday Toplist/);
assert.match(source, /function makeSearchToplistPanel\(\)/, 'Search renders a toplist panel');
assert.doesNotMatch(source, /FOLLOWED_UPLOADERS_STORAGE_KEY|function getFollowedUploaders\(/, 'uploader follows do not use separate local storage');
assert.match(source, /const FOLLOW_UPLOADERS_FAVCAT = 9;[\s\S]*?function requestFollowUploadersFavoritePaths\(\)[\s\S]*?favorites\.php[\s\S]*?function loadFollowedUploaderEntries\([\s\S]*?#gdn a\[href\*=\"\/uploader\/\"\]/, 'uploader follows are read from saved galleries in the dedicated favorites folder');
assert.match(source, /function toggleWatchedTagInMyTags\([\s\S]*?document\.createElement\('iframe'\)[\s\S]*?save\.click\(\)/, 'follow toggles save through a hidden native My Tags form without navigating the detail page');
assert.match(source, /function followUploaderViaFavorites\(name, galleryHref, onComplete = \(\) => \{\}\)[\s\S]*?setGalleryInFollowUploadersFavorites\(path, shouldFollow\)/, 'uploader follow toggles save or remove a gallery from the dedicated favorites folder');
assert.match(source, /toggleWatchedTagInMyTags\(tag, \(success, isWatched\)/, 'detail author buttons toggle their Watched state in place');
assert.match(source, /async function setGalleryInFollowUploadersFavorites\([\s\S]*?submitFavoriteFormLikeBrowser\(\s*form,\s*popupUrl,\s*shouldFollow \? String\(FOLLOW_UPLOADERS_FAVCAT\) : 'favdel'/, 'uploader follow state submits the fetched native favorites form');
assert.match(source, /async function submitFavoriteFormLikeBrowser\([\s\S]*?formData\.set\('apply', submitValue\)[\s\S]*?const body = new window\.URLSearchParams\(\)[\s\S]*?body\.append\(name, value\)/, 'favorite POST serializes the native form as URL-encoded fields');
assert.match(source, /referrer: popupUrl\.href[\s\S]*?referrerPolicy: 'same-origin'[\s\S]*?'Content-Type': 'application\/x-www-form-urlencoded;charset=UTF-8'/, 'favorite POST uses the popup URL as same-origin referrer and native form encoding');
assert.match(source, /\['uploaders', '上传者'\][\s\S]*?ehtw_following=\$\{mode\}/, 'Watched follow view has a separate uploader feed option');
assert.match(source, /feedSources = \(await requestWatchedUploaderNames\(\)\)\.map[\s\S]*?uploader\.href/, 'uploader feed reads followed uploader names from saved gallery details');
assert.match(source, /ehtw-menu-follow-uploader/, 'gallery cards can follow an uploader independently');
assert.match(source, /ehtw-detail-follow-actions[\s\S]*?关注上传者/, 'gallery details expose author and uploader follow controls');
assert.match(source, /append\(card, toplistShortcuts\)/, 'toplist lists render underneath Search');
assert.match(source, /\['Yesterday Toplist', '\/toplist\.php\?tl=15'\],[\s\S]*?\['Month Toplist', '\/toplist\.php\?tl=13'\]/, 'Yesterday Toplist appears above Month Toplist');
assert.match(source, /create\('ol', 'ehtw-search-toplist-list'\)/, 'each toplist displays ranked gallery entries');
assert.match(source, /create\('details', 'ehtw-search-toplist-more'\)/, 'entries after the first five are collapsible');
assert.match(source, /ehtw-search-toplist-more > \.ehtw-search-toplist-extra\s*\{\s*order:\s*1;[\s\S]*?ehtw-search-toplist-more > summary\s*\{\s*order:\s*2;/, 'Show more moves below expanded entries');
assert.match(source, /entryIndex < 5 \? list : moreList/, 'only five entries are visible before expanding');
assert.match(source, /create\('span', 'ehtw-search-toplist-cover'\)/, 'each toplist row reserves a cover thumbnail');
assert.match(source, /data-src[\s\S]*?data-original[\s\S]*?getAttribute\('src'\)/, 'cover thumbnails support lazy and direct image sources');
assert.match(source, /const displayEntries = visibleEntries\.slice\(0, 10\)/, 'the Search sidebar displays ten entries after hidden tags are removed');
assert.match(source, /const toplistEntryLimit = 50/, 'toplist requests retain fifty candidates to backfill hidden entries');
assert.match(source, /window\.fetch\(href,\s*\{\s*credentials: 'same-origin'/, 'toplists load from the native pages');
assert.match(source, /if \(entries\.length\) \{\s*cache\[href\]/, 'empty or blocked responses are not cached');
assert.match(source, /\/toplist\.php\?tl=13/);
assert.match(source, /\/toplist\.php\?tl=15/);
assert.doesNotMatch(source, /Loaded recent results for followed creators/, 'successful author loads have no bottom status message');
assert.match(source, /html\.ehtw-following-authors #toppane\s*\{\s*display: none !important;/, 'empty native title pane does not leave a gap above the feed');
assert.match(source, /if \(isFollowingFeedPage\) \{\s*setStyleSafe\(toppane, 'display', 'none'\)/, 'custom follow feeds collapse the native top pane at runtime');
assert.match(source, /if \(!isFollowingFeedPage\) append\(timeline, infiniteStatus\)/, 'custom follow feeds attach the status after their mode tabs and results');

console.log('PASS Following Authors aggregates and sorts followed creator tag pages');
