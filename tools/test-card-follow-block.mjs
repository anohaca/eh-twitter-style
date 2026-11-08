import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');

function extractDeclaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated declaration ${name}`);
}

const context = vm.createContext({});
vm.runInContext(extractDeclaration('normalizeCreatorFollowTag'), context);
const normalizeCreatorFollowTag = vm.runInContext('normalizeCreatorFollowTag', context);
assert.equal(normalizeCreatorFollowTag('artist:Foo_Bar'), 'artist:foo bar');
assert.equal(normalizeCreatorFollowTag('group:Circle+Name'), 'group:circle name');

assert.match(source, /@version\s+1\.17\.278/);
assert.match(source, /toggleWatchedTagInMyTags\(tag, \(success, isWatched\)/, 'card follow toggles the native My Tags Watch state in place');
assert.match(source, /ehtw_block_uploader=/, 'card block routes through My Settings');
assert.match(source, /qs\('#tagname_new'\)/, 'new artist tags use the native My Tags input');
assert.match(source, /qs\(`#tagsave_\$\{rowId\}`\)/, 'follow uses the row Save control');
assert.match(source, /qs\('#xu'\)/, 'uploader blocking uses native Excluded Uploaders');
assert.match(source, /=== 'apply'/, 'uploader blocking invokes the native Apply control');
assert.match(source, /requestWatchedMyTagsPage\(\)\.then\(getWatchedCreatorTagsFromMyTags\)/, 'Following Authors reads native watched creator tags');
assert.match(source, /ehtw-card-follow-button/);
assert.match(source, /ehtw-follow-choice-wrap/, 'cards with artist and group tags let the user choose');
assert.match(source, /关注 \$\{type\} ·/, 'the chooser labels only Artist and Group options');
assert.match(source, /ehtw-menu-block-uploader/);
assert.match(source, /ehtw-tweet-author:has\(\.ehtw-card-follow-button\)/, 'follow action is placed and sized in the author row');
assert.match(source, /creatorTagsOnly &&[\s\S]*?isCreatorTagValue\(raw\)/, 'Following Authors card tags are filtered to artist/group');
assert.match(source, /creatorTags\.push\(/, 'title-derived author names also get a follow action');
assert.match(source, /buildCardModerationActions\(\n\s+tweet,\n\s+listCreatorTags,\n\s+listAuthor,\n\s+uploader\.name/, 'actions are built from list data before gallery details finish loading');
assert.match(source, /stats\.author \|\| tweet\._ehtwListAuthor/, 'gallery metadata fallback does not erase list-derived author actions');
assert.match(source, /const label = create\('button', 'ehtw-detail-follow-button', type\)[\s\S]*?toggleWatchedTagInMyTags\(tag, \(success, nowFollowed, reason\)/, 'detail author follow uses a selectable chip');
assert.match(source, /uploaderButton\.addEventListener\('click', \(\) => \{[\s\S]*?followUploaderViaFavorites\(uploaderName, location\.pathname, \(success, nowFollowed, reason\)/, 'detail uploader follow toggles through the dedicated favorites folder without navigating away');
assert.match(source, /const updateLabel = \(\) => \{\s*label\.textContent = type;[\s\S]*?label\.setAttribute\('aria-pressed', String\(isFollowed\)\)[\s\S]*?取消关注/, 'detail author chips show selection state and remain individually toggleable');
assert.match(source, /uploaderButton\.textContent = '上传者';[\s\S]*?uploaderButton\.setAttribute\('aria-pressed', String\(uploaderFollowed\)\)[\s\S]*?取消关注/, 'detail uploader chip shows its independent selection state');
assert.match(source, /setFollowStatus\('正在保存到上传者收藏夹…'\)[\s\S]*?setFollowStatus\([\s\S]*?!success/, 'detail uploader follow clicks show progress and a visible failure message');
assert.match(source, /attempt < 16; attempt \+= 1[\s\S]*?setTimeout\(resolve, 750\)/, 'My Tags save confirmation waits for a slow asynchronous save');
assert.match(source, /window\.fetch\('\/mytags'[\s\S]*?iframe\.srcdoc = `<!doctype html>/, 'My Tags editor loads from same-origin markup in srcdoc when direct framing is blocked');
assert.match(source, /form\.action = new URL\('\/mytags', window\.location\.origin\)\.href/, 'srcdoc form posts back to the native My Tags route');
assert.match(source, /let srcdocAssigned = false;[\s\S]*?if \(!srcdocAssigned\) return;[\s\S]*?srcdocAssigned = true;[\s\S]*?document\.body\.appendChild\(iframe\)/, 'the about:blank frame load cannot prematurely abort the My Tags editor');
assert.match(source, /method: 'setusertag'[\s\S]*?xhr\.open\('POST', api\.apiUrl, true\)[\s\S]*?xhr\.withCredentials = true/, 'existing My Tags tags update through the top-level native XHR API');
assert.doesNotMatch(source, /nameInput\.dispatchEvent\(new eventWindow\.Event\('input'/, 'new My Tags tags skip the cross-origin suggestion request from srcdoc');
assert.match(source, /if \(isUploader\) \{[\s\S]*?No matching tag found[\s\S]*?uploader:<名称>[\s\S]*?let base = editor\.querySelector\('base'\)/, 'unsupported uploader tags fail clearly instead of leaving the button in a saving state');
assert.match(source, /\.ehtw-detail-follow-actions\s*\{[\s\S]*?justify-content: flex-end;[\s\S]*?margin: 0 0 0 auto;/, 'detail follow chips are aligned at the right side of the author row');
assert.match(source, /append\(author, meta\);[\s\S]*?append\(author, followActions\)/, 'follow chips sit beside author metadata instead of below it');
assert.match(source, /html\.ehtw-detail \.ehtw-detail-follow-actions > \.ehtw-detail-follow-button\s*\{[\s\S]*?background: transparent !important;[\s\S]*?color: #1d9bf0 !important/, 'unselected detail chips use an outlined Twitter blue style');
assert.match(source, /\.ehtw-detail-follow-button\[aria-pressed="true"\]\s*\{[\s\S]*?background: #1d9bf0 !important;[\s\S]*?color: #fff !important/, 'selected detail chips use a filled blue style');
assert.match(source, /\.ehtw-detail-follow-button\[aria-pressed="true"\]::before\s*\{\s*content: '✓';/, 'selected detail chips display a check mark');
console.log('Native card follow/block wiring checks passed.');
