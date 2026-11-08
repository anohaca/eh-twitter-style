import {test,expect,ui,open,navigate,settle} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,scale,origins,installRunHooks,checkInvariants,logOperation} from './probe.mjs';
import {THRESHOLDS} from './thresholds.mjs';
const storageKeys=`(()=>{try{const marker='__ehtw_stability_storage_seeded_v1__';if(window.name.includes(marker))return;const ls=window.localStorage,ss=window.sessionStorage;if(!ls||!ss)return;window.name+=(window.name?'|':'')+marker;const keys=['ehtw-gallery-back-traversal-v1','ehtw-gallery-following-author-stats-v1','ehtw-gallery-stats-v6','ehtw-reader-mode-v1','ehtw-reader-page-link-preload-count-v1','ehtw-reader-preload-count-v2','ehtw-reader-zoom-percent-v1','ehtw-search-hidden-tags-v1','ehtw-search-toplist-data-v5','ehtw.followUploaders.galleryNames.v1','ehtw-scroll-v1:'+location.href,'ehtw-scroll-pageshow-restore-v1:'+location.href,'ehtw-back-target-v1:'+location.href,'ehtw-gallery-return-v1:5000','ehtw-gallery-return-depth-v1:5000'];for(const s of [ls,ss])for(const k of keys)if(s.getItem(k)===null)s.setItem(k,'{invalid-json');window.__ehtwStoragePreseeded=true}catch(_){}})();`;
const huge=`(()=>{try{if(!['https://e-hentai.org','https://exhentai.org'].includes(location.origin))return;const marker='__ehtw_stability_huge_v1__';if(window.name.includes(marker))return;window.localStorage.setItem('ehtw-stability-large-v1','x'.repeat(1024*1024));window.name+=(window.name?'|':'')+marker;window.__ehtwHugeStorageApplied=true}catch(error){(window.__ehtwPreInitErrors||=[]).push(String(error?.stack||error))}})();`;
const quota=`(()=>{try{Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError')};window.__ehtwQuotaSetupApplied=true}catch(_){}})();`;
const localThrow=`(()=>{try{Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('denied','SecurityError')}});window.__ehtwLocalStorageBlocked=true}catch(_){}})();`;
const sessionNull=`(()=>{try{Object.defineProperty(window,'sessionStorage',{configurable:true,get(){return null}});window.__ehtwSessionStorageNull=true}catch(_){}})();`;
const cases=[['invalid JSON',storageKeys],['1 MB value',huge],['QuotaExceededError',quota],['localStorage getter throws',localThrow],['sessionStorage is null',sessionNull]];
const isolatedPreInit=setup=>`try{${PROBE_SCRIPT}}catch(error){(window.__ehtwPreInitErrors||=[]).push(String(error?.stack||error))}\ntry{${setup}}catch(error){(window.__ehtwPreInitErrors||=[]).push(String(error?.stack||error))}`;
for(const [label,init] of cases)for(const origin of origins)test.describe(`G storage fault ${label} ${origin}`,()=>{
 test.use({preInitScript:isolatedPreInit(init)});installRunHooks(test);
 test(`resilience ${label}`,async({page,site,diagnostics},testInfo)=>{
  testInfo.annotations.push({type:'storage-setup',description:label});await open(page,`${origin}/`,{waitFor:'html.ehtw-list'});expect(await page.evaluate(()=>window.__ehtwProbe?.ready)).toBe(true);expect(await page.evaluate(()=>window.__ehtwPreInitErrors||[])).toEqual([]);const setupFlags={'invalid JSON':'__ehtwStoragePreseeded','1 MB value':'__ehtwHugeStorageApplied',QuotaExceededError:'__ehtwQuotaSetupApplied','localStorage getter throws':'__ehtwLocalStorageBlocked','sessionStorage is null':'__ehtwSessionStorageNull'};expect(await page.evaluate(flag=>window[flag]===true,setupFlags[label]),`pre-init for ${label} must have run`).toBe(true);
  for(let i=0;i<scale(2,5);i++){const g=site.state.galleries[i],card=ui(page).locator(`#ehtw-shell .ehtw-tweet[data-ehtw-href*="/g/${g.gid}/"] a[href*="/g/"]`).first();await navigate(page,()=>card.click(),new RegExp(`/g/${g.gid}/`),'ehtw-detail');await settle(page);logOperation(testInfo,`${origin} ${label} detail ${i+1}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-detail');await navigate(page,()=>page.goBack(),`${origin}/`,'ehtw-list');logOperation(testInfo,`${origin} ${label} back ${i+1}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list')}
  expect(diagnostics.pageErrors).toEqual([]);
 });
});
for(const origin of origins)test.describe(`G reload storage bounded ${origin}`,()=>{
 test.use({preInitScript:PROBE_SCRIPT});installRunHooks(test);
 test('storage keys and bytes stay bounded',async({page,diagnostics,site},testInfo)=>{
 const n=scale(3,100);await open(page,`${origin}/`,{waitFor:'html.ehtw-list'});let maxKeys=0,maxBytes=0;
 for(let i=0;i<n;i++){await page.reload({waitUntil:'load'});await page.locator('html.ehtw-list').waitFor({state:'attached',timeout:15_000});await settle(page);const s=await page.evaluate(()=>{let keys=0,bytes=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)||'',v=localStorage.getItem(k)||'';if(k.startsWith('ehtw')){keys++;bytes+=(k.length+v.length)*2}}return{keys,bytes}});maxKeys=Math.max(maxKeys,s.keys);maxBytes=Math.max(maxBytes,s.bytes);logOperation(testInfo,`${origin} storage reload ${i+1}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list')}
 expect(maxKeys).toBeLessThanOrEqual(THRESHOLDS.storage.maxKeys);expect(maxBytes).toBeLessThanOrEqual(THRESHOLDS.storage.maxBytes);
 });
});
