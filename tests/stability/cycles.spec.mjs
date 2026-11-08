import {test,expect,ui,open,navigate,settle,tap} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,scale,origins,checkInvariants,snapshot,installRunHooks,logOperation,liveTimeoutIds,waitForNewTimeoutsToDrain} from './probe.mjs';
import {THRESHOLDS} from './thresholds.mjs';
test.use({preInitScript:PROBE_SCRIPT});installRunHooks(test);
function resourceParts(s){const p={listeners_window:s.listeners.window,listeners_document:s.listeners.document,listeners_element:s.listeners.element,listeners_elementConnected:s.listeners.elementConnected,observer_MutationObserver:s.observers.MutationObserver.alive,observer_MutationObserver_targets:s.observers.MutationObserver.targets,observer_IntersectionObserver:s.observers.IntersectionObserver.alive,observer_IntersectionObserver_targets:s.observers.IntersectionObserver.targets,observer_ResizeObserver:s.observers.ResizeObserver.alive,observer_ResizeObserver_targets:s.observers.ResizeObserver.targets,timer:s.timers.timeouts,interval:s.timers.intervals};for(const category of ['window','document','element'])for(const [type,count]of Object.entries(s.listeners.byType[category]))p[`listener_${category}_${type}`]=count;return p}
function exactResources(a,b,label){const x=resourceParts(a),y=resourceParts(b),keys=new Set([...Object.keys(x),...Object.keys(y)]),d=Object.fromEntries([...keys].map(k=>[k,(y[k]||0)-(x[k]||0)])),diffs=Object.entries(d).filter(([,v])=>v!==0).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));if(diffs.length)throw new Error(`${label} resource deltas; largest=${JSON.stringify(diffs[0])} all=${JSON.stringify(d)}`)}
function nodesBounded(a,b,label){expect(Math.abs(b.cdp.Nodes-a.cdp.Nodes)/Math.max(1,a.cdp.Nodes),`${label} DOM Nodes: ${a.cdp.Nodes} -> ${b.cdp.Nodes}`).toBeLessThanOrEqual(.05)}

for(const origin of origins)test(`B1 list → detail → Back ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const g=site.state.galleries[0],baselineCycles=scale(3,10),n=scale(4,300);await open(page,`${origin}/`);const baselineTimeoutIds=await liveTimeoutIds(page);
 const cycle=async i=>{await navigate(page,()=>ui(page).locator(`#ehtw-shell .ehtw-tweet[data-ehtw-href*="/g/${g.gid}/"] a[href*="/g/"]`).first().click(),new RegExp(`/g/${g.gid}/`),'ehtw-detail');await navigate(page,()=>page.goBack(),`${origin}/`,'ehtw-list');await settle(page);logOperation(testInfo,`${origin} B1 cycle ${i}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list')};
 for(let i=1;i<=baselineCycles;i++)await cycle(i);
 const drainedBaseline=await snapshot(page);
 for(let i=baselineCycles+1;i<=n;i++)await cycle(i);
 if(process.env.EHTW_STABILITY==='full')await page.waitForTimeout(THRESHOLDS.readerWatchdogDrainMs);else await waitForNewTimeoutsToDrain(page,baselineTimeoutIds);const after=await snapshot(page),persistentErrorDelta=(after.listeners.byType.element.error||0)-(drainedBaseline.listeners.byType.element.error||0);testInfo.annotations.push({type:'B1-after-watchdog-drain',description:`element:error listener difference after watchdog drain and ${n-baselineCycles} additional cycles=${persistentErrorDelta}`});exactResources(drainedBaseline,after,`B1 cycle ${n} after watchdog drain`);nodesBounded(drainedBaseline,after,`B1 cycle ${n} after watchdog drain`);
});

for(const origin of origins)test(`B2 detail → reader → Back ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const g=site.state.galleries[0],baselineCycles=scale(3,10),n=scale(4,150);await open(page,`${origin}/g/${g.gid}/${g.token}/`);const baselineTimeoutIds=await liveTimeoutIds(page);
 const cycle=async i=>{await navigate(page,()=>ui(page).locator('#ehtw-shell a[href*="/s/"]').first().click(),/\/s\//,'ehtw-reader');await navigate(page,()=>page.goBack(),new RegExp(`/g/${g.gid}/`),'ehtw-detail');await settle(page);logOperation(testInfo,`${origin} B2 cycle ${i}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-detail')};
 for(let i=1;i<=baselineCycles;i++)await cycle(i);
 if(process.env.EHTW_STABILITY==='full')await page.waitForTimeout(THRESHOLDS.readerWatchdogDrainMs);else await waitForNewTimeoutsToDrain(page,baselineTimeoutIds);const drainedBaseline=await snapshot(page),additionalTimeoutIds=await liveTimeoutIds(page);
 for(let i=baselineCycles+1;i<=n;i++)await cycle(i);
 if(process.env.EHTW_STABILITY==='full')await page.waitForTimeout(THRESHOLDS.readerWatchdogDrainMs);else await waitForNewTimeoutsToDrain(page,additionalTimeoutIds);const after=await snapshot(page);exactResources(drainedBaseline,after,`B2 cycle ${n} after watchdog drain`);nodesBounded(drainedBaseline,after,`B2 cycle ${n} after watchdog drain`);
});

for(const origin of origins)test(`B2b reader cleanup clears detached image watchdog timers ${origin}`,async({page,site,diagnostics},testInfo)=>{
  const g=site.state.galleries[0],cycles=scale(2,5);await open(page,`${origin}/g/${g.gid}/${g.token}/`);const before=await snapshot(page),baselineTimeoutIds=await liveTimeoutIds(page);
  for(let i=1;i<=cycles;i++){await navigate(page,()=>ui(page).locator('#ehtw-shell a[href*="/s/"]').first().click(),/\/s\//,'ehtw-reader');await navigate(page,()=>page.goBack(),new RegExp(`/g/${g.gid}/`),'ehtw-detail');await settle(page);logOperation(testInfo,`${origin} B2b transient watchdog cycle ${i}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-detail')}
  await waitForNewTimeoutsToDrain(page,baselineTimeoutIds,5_000);
  const after=await snapshot(page);
  expect(after.timers.timeouts, 'reader cleanup leaves no live 30-second image watchdog attached to the detached reader DOM').toBeLessThanOrEqual(before.timers.timeouts);
});

for(const origin of origins)test(`B3 list → gallery pagination → Back ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const checkpoint=scale(5,10),n=scale(6,150),g=site.state.galleries[0];await open(page,`${origin}/`);let tenth=null;
 for(let i=1;i<=n;i++){await navigate(page,()=>ui(page).locator(`#ehtw-shell .ehtw-tweet[data-ehtw-href*="/g/${g.gid}/"] .ehtw-tweet-title .glink`).first().click(),new RegExp(`/g/${g.gid}/${g.token}/$`),'ehtw-detail');const expand=ui(page).locator('.ehtw-gallery-grid-section .ehtw-detail-expand-button'),entered={ariaExpanded:await expand.getAttribute('aria-expanded'),label:(await expand.textContent()||'').trim()};logOperation(testInfo,`${origin} B3 cycle ${i} gallery entry expansion state=${JSON.stringify(entered)}`,page.url());if(entered.ariaExpanded!=='true')await tap(page,testInfo,expand);await expect(expand).toHaveAttribute('aria-expanded','true');const next=ui(page).locator('.ehtw-gallery-pagination:visible a',{hasText:'2'}).first();await navigate(page,()=>tap(page,testInfo,next),/\?p=1$/,'ehtw-detail');await navigate(page,()=>page.goBack(),u=>u.origin===origin&&u.pathname==='/'&&u.search==='','ehtw-list');await settle(page);logOperation(testInfo,`${origin} B3 cycle ${i}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list');if(i%checkpoint===0){const s=await snapshot(page);if(i===checkpoint)tenth=s;else{exactResources(tenth,s,`B3 cycle ${i}`);nodesBounded(tenth,s,`B3 cycle ${i}`)}}}
 if(n%checkpoint!==0){const final=await snapshot(page);exactResources(tenth,final,`B3 cycle ${n}`);nodesBounded(tenth,final,`B3 cycle ${n}`)}
});
