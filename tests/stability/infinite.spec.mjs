import {test,expect,ui,open,settle} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,scale,origins,installRunHooks,checkInvariants,snapshot,logOperation,dataFor} from './probe.mjs';
import {THRESHOLDS} from './thresholds.mjs';
test.use({preInitScript:PROBE_SCRIPT,siteOptions:{recordTiming:true,galleryCount:scale(30,2000)}});installRunHooks(test);
for(const origin of origins)test(`C infinite list session ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const expected=scale(30,2000);expect(site.state.galleries.length).toBe(expected);await open(page,`${origin}/`);const initialNav=diagnostics.documentNavigations.length,seen=new Set();let previousUnique=0;
 for(let pageNo=0;pageNo<Math.ceil(expected/25)+2&&seen.size<expected;pageNo++){
  const currentlyVisible=await ui(page).locator('.ehtw-tweet[data-ehtw-href]').evaluateAll(es=>es.map(e=>e.getAttribute('data-ehtw-href')).filter(Boolean));
  expect(new Set(currentlyVisible).size).toBe(currentlyVisible.length);for(const href of currentlyVisible)seen.add(href);expect(seen.size).toBeGreaterThanOrEqual(previousUnique);previousUnique=seen.size;logOperation(testInfo,`${origin} scroll batch ${pageNo+1} unique=${seen.size}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list');
  if(seen.size>=expected)break;
  const status=ui(page).locator('.ehtw-list-infinite-status');const state=await status.getAttribute('data-state');if(state==='done')break;
  const response=state==='loading'?null:page.waitForResponse(r=>r.request().resourceType()==='fetch'&&new URL(r.url()).origin===origin&&new URL(r.url()).searchParams.has('next'),{timeout:20_000});
  await status.scrollIntoViewIfNeeded();if(response)await response;await expect.poll(()=>status.getAttribute('data-state'),{timeout:20_000}).not.toBe('loading');await settle(page);
 }
 const finalVisible=await ui(page).locator('.ehtw-tweet[data-ehtw-href]').evaluateAll(es=>es.map(e=>e.getAttribute('data-ehtw-href')).filter(Boolean));for(const href of finalVisible)seen.add(href);
 expect(seen.size,`unique hrefs seen (virtualized cards may leave DOM): ${seen.size}/${expected}`).toBe(expected);
 expect(diagnostics.documentNavigations.length).toBe(initialNav);const s=await snapshot(page);expect(s.network.peak).toBeLessThanOrEqual(THRESHOLDS.inflight.max);
 const galleryRequests=site.state.log.filter(x=>/\/g\/\d+\//.test(x.url)&&Number.isFinite(x.at)).map(x=>x.at);for(let i=1;i<galleryRequests.length;i++)expect(galleryRequests[i]-galleryRequests[i-1]).toBeGreaterThanOrEqual(1400);
 const cache=await page.evaluate(()=>{try{return Object.keys(JSON.parse(localStorage.getItem('ehtw-gallery-stats-v6')||'{}')).length}catch{return 0}});expect(cache).toBeLessThanOrEqual(800);
 await expect.poll(async()=>{const records=dataFor(testInfo).requestRecords,last=records.at(-1)?.at||Date.now(),fetchInflight=await page.evaluate(()=>window.__ehtwProbe?.network?.inflight||0);return Date.now()-last>=3000&&fetchInflight===0&&dataFor(testInfo).imageNetwork.inflight===0},{timeout:120_000,intervals:[100,200,500]}).toBe(true);const quietBaseline=await snapshot(page),requests=quietBaseline.network.created,requestStart=dataFor(testInfo).requestRecords.length;await page.waitForTimeout(5000);const quietRequests=dataFor(testInfo).requestRecords.slice(requestStart);expect(quietRequests,`new requests during five-second post-queue quiet window`).toEqual([]);expect((await snapshot(page)).network.created,`fetch/XHR count during quiet window: ${JSON.stringify(quietRequests)}`).toBe(requests);logOperation(testInfo,`${origin} cumulative unique gallery hrefs ${seen.size}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list');
});
