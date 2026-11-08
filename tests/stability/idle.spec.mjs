import {test,expect,open} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,scale,origins,installRunHooks,checkInvariants,snapshot,logOperation,dataFor} from './probe.mjs';
test.use({preInitScript:PROBE_SCRIPT});installRunHooks(test);
const IDLE_RECONCILIATION_INTERVALS=1; // Source: the single setInterval(..., 250) URL reconciliation at eh-twitter-style_user.js:25130.
async function waitForRequestQuiet(page,testInfo,quietMs=3000,maxWaitMs=120_000){
 const emptySince=Date.now();
 await expect.poll(async()=>{const records=dataFor(testInfo).requestTimes,last=records.length?records[records.length-1]:emptySince,fetchInflight=await page.evaluate(()=>window.__ehtwProbe?.network?.inflight||0),imageInflight=dataFor(testInfo).imageNetwork.inflight;return Date.now()-last>=quietMs&&fetchInflight===0&&imageInflight===0},{timeout:maxWaitMs,intervals:[100,200,500]}).toBe(true);
}
const routes=['list','detail','reader'];
for(const origin of origins)for(const route of routes)test(`I idle ${route} ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const seconds=scale(3,60),g=site.state.galleries[0],url=route==='list'?`${origin}/`:route==='detail'?`${origin}/g/${g.gid}/${g.token}/`:site.readerUrl(origin,g,1);
 await open(page,url,{waitFor:route==='reader'?'html.ehtw-reader':'html.ehtw-enabled'});if(route==='reader')await page.locator('.ehtw-reader-root[data-ehtw-reader-ready="true"]').waitFor({state:'attached',timeout:15_000});
 await waitForRequestQuiet(page,testInfo);const requestStart=dataFor(testInfo).requestRecords.length,before=await snapshot(page),task0=before.cdp.TaskDuration;await page.waitForTimeout(seconds*1000);const after=await snapshot(page),newRequests=dataFor(testInfo).requestRecords.slice(requestStart),newFetchRequests=newRequests.filter(r=>r.type==='fetch'||r.type==='xhr');
 expect(after.network.created,`new fetch/XHR during idle: ${JSON.stringify(newFetchRequests)}`).toBe(before.network.created);expect(after.network.images.created,`new image requests during idle: ${JSON.stringify(newRequests.filter(r=>r.type==='image'))}`).toBe(before.network.images.created);expect(after.timers.intervals).toBe(IDLE_RECONCILIATION_INTERVALS);
 expect(after.raf.callbacks-before.raf.callbacks).toBeLessThanOrEqual(2*seconds);
 expect((after.cdp.TaskDuration-task0)/seconds).toBeLessThan(.03);
 logOperation(testInfo,`${origin} idle ${route} ${seconds}s`,page.url());await checkInvariants(page,diagnostics,site,route==='list'?'ehtw-list':route==='detail'?'ehtw-detail':'ehtw-reader');
});
