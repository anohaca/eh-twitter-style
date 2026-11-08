import {test,expect,ui,open,settle} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,scale,origins,randomFor,installRunHooks,checkInvariants,snapshot,logOperation,dataFor} from './probe.mjs';
import {THRESHOLDS} from './thresholds.mjs';
test.use({preInitScript:PROBE_SCRIPT});installRunHooks(test);
const sizes=[[1440,900],[1000,800],[900,900],[699,900],[390,844],[844,390]];
function assertCountersNear(base,current,label){let maxGrowth=0;for(const type of ['window','document','element','elementConnected']){const delta=current.listeners[type]-base.listeners[type];expect(current.listeners[type],`${label} ${type} listeners`).toBeLessThanOrEqual(base.listeners[type]+THRESHOLDS.viewportCounterGrowth);maxGrowth=Math.max(maxGrowth,delta)}for(const name of Object.keys(base.observers)){const aliveDelta=current.observers[name].alive-base.observers[name].alive,targetDelta=current.observers[name].targets-base.observers[name].targets;expect(current.observers[name].alive,`${label} ${name}`).toBeLessThanOrEqual(base.observers[name].alive+THRESHOLDS.viewportCounterGrowth);expect(current.observers[name].targets,`${label} ${name} targets`).toBeLessThanOrEqual(base.observers[name].targets+THRESHOLDS.viewportCounterGrowth);maxGrowth=Math.max(maxGrowth,aliveDelta,targetDelta)}const intervalDelta=current.timers.intervals-base.timers.intervals;expect(current.timers.intervals,`${label} intervals`).toBeLessThanOrEqual(base.timers.intervals+THRESHOLDS.viewportCounterGrowth);return Math.max(0,maxGrowth,intervalDelta)}

for(const origin of origins)test(`J viewport random resize ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const rng=randomFor(dataFor(testInfo).seed),n=scale(4,200),samples=[];let maxCounterGrowth=0;await open(page,`${origin}/`);const base=await snapshot(page);
 for(let i=0;i<n;i++){const [width,height]=sizes[rng.int(sizes.length)];await page.setViewportSize({width,height});await settle(page);const s=await snapshot(page);samples.push(s);logOperation(testInfo,`${origin} viewport ${width}x${height}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list');maxCounterGrowth=Math.max(maxCounterGrowth,assertCountersNear(base,s,`viewport step ${i+1}`))}
 testInfo.annotations.push({type:'J-viewport-counter-growth',description:JSON.stringify({origin,mode:'resize',steps:n,maxCounterGrowth})});
});

for(const origin of origins)test(`J viewport and theme color changes ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const n=scale(4,200);let maxCounterGrowth=0;await open(page,`${origin}/`);const base=await snapshot(page);for(let i=0;i<n;i++){const scheme=i%2?'dark':'light';await page.emulateMedia({colorScheme:scheme});await settle(page);const bg=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);expect(bg,`theme at transition ${i+1}`).toBe(scheme==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)');const current=await snapshot(page);maxCounterGrowth=Math.max(maxCounterGrowth,assertCountersNear(base,current,`theme transition ${i+1}`));logOperation(testInfo,`${origin} theme ${scheme}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list')}
 testInfo.annotations.push({type:'J-viewport-counter-growth',description:JSON.stringify({origin,mode:'theme',steps:n,maxCounterGrowth})});
});
