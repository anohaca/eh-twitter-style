import {test,expect,ui,open,tap,settle} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,scale,origins,randomFor,logOperation,checkInvariants,snapshot,installRunHooks,dataFor,navEntry,routeClassFromPage,routeFor,waitForRouteWithContext,liveTimeoutIds,waitForNewTimeoutsToDrain} from './probe.mjs';
import {THRESHOLDS} from './thresholds.mjs';
test.use({preInitScript:PROBE_SCRIPT});installRunHooks(test);

for(const origin of origins)test(`A random navigation soak ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const rng=randomFor(dataFor(testInfo).seed),steps=scale(1,200),samples=[];
 await open(page,`${origin}/`);
 const home=async()=>{if(new URL(page.url()).pathname!=='/'){await tap(page,testInfo,await navEntry(page,testInfo,'Front Page'));await waitForRouteWithContext(page,`${origin}/`,'ehtw-list',15_000)}const more=ui(page).locator('#ehtw-left #nb .ehtw-more-button');if(await more.isVisible()&&await more.getAttribute('aria-expanded')==='true'){await tap(page,testInfo,more);await expect(more).toHaveAttribute('aria-expanded','false')}await settle(page);logOperation(testInfo,`${origin} soak replay home`,page.url())};
 const galleries=site.state.galleries.slice(0,20).map(g=>({gid:g.gid,token:g.token,pages:g.pages,detail:`${origin}/g/${g.gid}/${g.token}/`}));
 const navLinks=await ui(page).locator('#ehtw-left #nb a[href]').evaluateAll(links=>links.map(a=>({label:(a.textContent||'').trim(),url:a.href})).filter(x=>x.url.startsWith(location.origin)&&x.label&&x.label!=='Front Page'));
 const navLabels=[...new Set(navLinks.filter(x=>routeFor(new URL(x.url))).map(x=>x.label))];expect(galleries.length).toBe(20);expect(navLabels.length,'homepage exposes navigation entries').toBeGreaterThan(1);
 const fragments=Array.from({length:steps},()=>{
  const kind=['gallery-back','reader-back','forward-back','navigation-back','navigation-home'][rng.int(5)],g=galleries[rng.int(galleries.length)];
  if(kind==='gallery-back')return{kind,gid:g.gid,detail:g.detail};
  if(kind==='reader-back')return{kind,gid:g.gid,detail:g.detail,k:rng.int(Math.max(1,Math.min(20,g.pages))),m:1+rng.int(3)};
  if(kind==='forward-back')return{kind,gid:g.gid,detail:g.detail};
  const x=navLabels[rng.int(navLabels.length)];if(kind==='navigation-back')return{kind,x};
  let y=navLabels[rng.int(navLabels.length)];if(y===x)y=navLabels[(navLabels.indexOf(x)+1)%navLabels.length];return{kind,x,y};
 });
 testInfo.annotations.push({type:'A-operation-fragments',description:JSON.stringify(fragments)});
 const go=async(url)=>{const expected=routeFor(new URL(url));await waitForRouteWithContext(page,url,expected,15_000)};
 const check=async(pass,index)=>{await settle(page);logOperation(testInfo,`${origin} replay ${pass} fragment ${index+1} ${fragments[index].kind}`,page.url());await checkInvariants(page,diagnostics,site,await routeClassFromPage(page))};
 const execute=async(fragment,pass,index)=>{
  await home();
  if(fragment.kind==='gallery-back'||fragment.kind==='reader-back'||fragment.kind==='forward-back'){
   const card=ui(page).locator(`#ehtw-shell .ehtw-tweet[data-ehtw-href="${fragment.detail}"] .ehtw-tweet-title a`).first();await expect(card,`gallery ${fragment.gid} is in the first 20 homepage entries`).toBeVisible();await tap(page,testInfo,card);await go(fragment.detail);
   if(fragment.kind==='reader-back'){
    const thumbs=ui(page).locator('#gdt a[href*="/s/"]');await expect(thumbs.nth(fragment.k)).toBeVisible();const href=await thumbs.nth(fragment.k).getAttribute('href');await tap(page,testInfo,thumbs.nth(fragment.k));await go(new URL(href,page.url()).href);
    for(let turn=0;turn<fragment.m;turn++){await page.keyboard.press('ArrowRight');await settle(page)}
    await page.goBack();await waitForRouteWithContext(page,fragment.detail,'ehtw-detail',15_000);await page.goBack();await waitForRouteWithContext(page,`${origin}/`,'ehtw-list',15_000);
   }else{
    await page.goBack();await waitForRouteWithContext(page,`${origin}/`,'ehtw-list',15_000);
    if(fragment.kind==='forward-back'){await page.goForward();await waitForRouteWithContext(page,fragment.detail,'ehtw-detail',15_000);await page.goBack();await waitForRouteWithContext(page,`${origin}/`,'ehtw-list',15_000)}
   }
  }else if(fragment.kind==='navigation-back'){
   await tap(page,testInfo,await navEntry(page,testInfo,fragment.x));await go(navLinks.find(x=>x.label===fragment.x).url);await page.goBack();await waitForRouteWithContext(page,`${origin}/`,'ehtw-list',15_000);
  }else{
   await tap(page,testInfo,await navEntry(page,testInfo,fragment.x));await go(navLinks.find(x=>x.label===fragment.x).url);await tap(page,testInfo,await navEntry(page,testInfo,fragment.y));await go(navLinks.find(x=>x.label===fragment.y).url);await tap(page,testInfo,await navEntry(page,testInfo,'Front Page'));await waitForRouteWithContext(page,`${origin}/`,'ehtw-list',15_000);
  }
  await check(pass,index);
 };
 const captureDom=()=>page.evaluate(()=>{const tweets=[...document.querySelectorAll('.ehtw-tweet')],menus=[...document.querySelectorAll('.ehtw-card-more-menu .ehtw-menu')].filter(menu=>menu.querySelector('a.ehtw-menu-item')),subtree=el=>1+el.querySelectorAll('*').length;return{tweets:tweets.length,filledMenus:menus.length,nodesPerTweet:tweets.length?tweets.reduce((n,e)=>n+subtree(e),0)/tweets.length:0,nodesPerFilledMenu:menus.length?menus.reduce((n,e)=>n+subtree(e),0)/menus.length:0}});
 for(let pass=1;pass<=3;pass++){const timeoutIds=await liveTimeoutIds(page);await home();for(let i=0;i<fragments.length;i++)await execute(fragments[i],pass,i);await home();if(process.env.EHTW_STABILITY==='full')await page.waitForTimeout(THRESHOLDS.readerWatchdogDrainMs);else await waitForNewTimeoutsToDrain(page,timeoutIds);const snap=await snapshot(page),dom=await captureDom(),adjustedNodes=snap.cdp.Nodes-dom.tweets*dom.nodesPerTweet-dom.filledMenus*dom.nodesPerFilledMenu;const point={pass,snapshot:snap,dom,adjustedNodes};samples.push(point);dataFor(testInfo).samples.push({origin,checkpoint:`pass-${pass}-watchdog-drained`,...point});}
 const [second,third]=samples.slice(1),nodeDelta=third.snapshot.cdp.Nodes-second.snapshot.cdp.Nodes,nodePercent=Math.abs(nodeDelta)/Math.max(1,second.snapshot.cdp.Nodes),observerDelta={};for(const key of new Set([...Object.keys(second.snapshot.observers),...Object.keys(third.snapshot.observers)]))observerDelta[key]=(third.snapshot.observers[key]?.alive||0)-(second.snapshot.observers[key]?.alive||0);
 const intervalDelta=third.snapshot.timers.intervals-second.snapshot.timers.intervals,listenerDelta={};for(const category of ['window','document','element'])for(const type of new Set([...Object.keys(second.snapshot.listeners.byType[category]),...Object.keys(third.snapshot.listeners.byType[category])])){const key=`${category}:${type}`;listenerDelta[key]=(third.snapshot.listeners.byType[category][type]||0)-(second.snapshot.listeners.byType[category][type]||0)}
 expect(nodePercent,`CDP Nodes pass 2→3 difference; values=${second.snapshot.cdp.Nodes},${third.snapshot.cdp.Nodes}; delta=${nodeDelta}`).toBeLessThanOrEqual(.05);expect(observerDelta,`observer alive deltas pass 2→3`).toEqual(Object.fromEntries(Object.keys(observerDelta).map(k=>[k,0])));expect(intervalDelta,`interval delta pass 2→3`).toBe(0);
 const heapDelta=third.snapshot.cdp.JSHeapUsedSize-second.snapshot.cdp.JSHeapUsedSize;expect(heapDelta,`heap pass 2→3 delta bytes`).toBeLessThanOrEqual(THRESHOLDS.soakHeapPassDeltaBytes);
 const listenerDiffs=Object.entries(listenerDelta).filter(([,value])=>value!==0);expect(listenerDiffs,`listener target:type deltas; all-zero required; all=${JSON.stringify(listenerDelta)}`).toEqual([]);
 testInfo.annotations.push({type:'A-pass-snapshots',description:JSON.stringify({samples:samples.map(({pass,snapshot,dom,adjustedNodes})=>({pass,Nodes:snapshot.cdp.Nodes,adjustedNodes,tweets:dom.tweets,nodesPerTweet:dom.nodesPerTweet,filledMenus:dom.filledMenus,nodesPerFilledMenu:dom.nodesPerFilledMenu,Documents:snapshot.cdp.Documents,listeners:snapshot.listeners.window+snapshot.listeners.document+snapshot.listeners.element,byType:snapshot.listeners.byType,observers:snapshot.observers,timers:snapshot.timers,heapBytes:snapshot.cdp.JSHeapUsedSize})),comparison:{nodeDelta,nodePercent,observerDelta,intervalDelta,heapDelta,listenerDelta}})});
});
