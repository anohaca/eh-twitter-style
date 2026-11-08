import {test,expect,ui,open,navigate,waitForRoute,settle,tap} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,scale,origins,installRunHooks,checkInvariants,logOperation,navEntry,routeClassFromPage,waitForRouteWithContext} from './probe.mjs';
test.use({preInitScript:PROBE_SCRIPT});installRunHooks(test);
const startClickCapture=page=>page.evaluate(()=>{window.__stabilityClickTargets=[];window.__stabilityClickCapture=event=>{const anchor=event.target?.closest?.('a[href]');window.__stabilityClickTargets.push(anchor?.href||null)};document.addEventListener('click',window.__stabilityClickCapture,true)});
const finishClickCapture=page=>page.evaluate(()=>{document.removeEventListener('click',window.__stabilityClickCapture,true);return window.__stabilityClickTargets});
async function expectLastTarget(page,targets,last){await page.waitForFunction(()=>!document.documentElement.classList.contains('ehtw-navigation-pending'),null,{timeout:15_000});const actual=page.url();expect(actual,`burst targets=${JSON.stringify(targets)} expected last=${last}`).toBe(last)}

for(const origin of origins)test(`F1a programmatic anchor clicks resolve to last gallery ${origin}`,async({page,site,diagnostics},testInfo)=>{
 {const rounds=scale(1,60);await open(page,`${origin}/`);const docs=diagnostics.documentNavigations.length;
 for(let r=0;r<rounds;r++){const cards=ui(page).locator('#ehtw-shell .ehtw-tweet[data-ehtw-href]'),count=await cards.count(),n=Math.min(3+r%3,count),targets=[];for(let i=0;i<n;i++)targets.push(await cards.nth((r+i)%count).getAttribute('data-ehtw-href'));expect(new Set(targets).size).toBe(n);const expectedTitle=await page.evaluate(href=>[...document.querySelectorAll('#ehtw-shell .ehtw-tweet[data-ehtw-href]')].find(x=>x.getAttribute('data-ehtw-href')===href)?.querySelector('.ehtw-tweet-title .glink')?.textContent.trim(),targets.at(-1)),last=new URL(targets.at(-1),origin).href;site.state.faults.push({name:`burst-a-${r}`,path:new URL(targets[0],origin).pathname,type:'fetch',delayMs:400,times:1});logOperation(testInfo,`${origin} F1a expected targets=${JSON.stringify(targets)} expectedLast=${last}`,page.url());await startClickCapture(page);
  const elapsed=await page.evaluate(targets=>{const start=performance.now();for(const href of targets){const card=[...document.querySelectorAll('#ehtw-shell .ehtw-tweet[data-ehtw-href]')].find(x=>x.getAttribute('data-ehtw-href')===href),anchor=card?.querySelector('.ehtw-tweet-title .glink')?.closest('a');anchor?.click()}return performance.now()-start},targets);const actual=await finishClickCapture(page);logOperation(testInfo,`${origin} F1a actual targets=${JSON.stringify(actual)} elapsed=${elapsed}ms`,page.url());expect(elapsed,`synthetic-anchor burst elapsed=${elapsed}ms targets=${JSON.stringify(targets)} actual=${JSON.stringify(actual)}`).toBeLessThanOrEqual(50);expect(actual).toEqual(targets.map(href=>new URL(href,origin).href));
  await expectLastTarget(page,targets,last);await settle(page);await checkInvariants(page,diagnostics,site,'ehtw-detail');expect(await page.locator('#gn').textContent()).toBe(expectedTitle);expect(diagnostics.documentNavigations.length).toBe(docs);await page.goBack();await waitForRoute(page,`${origin}/`,'ehtw-list')
 }
 }
});

for(const origin of origins)test(`F1b real page.mouse clicks resolve to last gallery ${origin}`,async({page,site,diagnostics},testInfo)=>{
 {const size=page.viewportSize();await page.setViewportSize({width:size.width,height:5000});const rounds=scale(1,60);await open(page,`${origin}/`);const docs=diagnostics.documentNavigations.length;
 for(let r=0;r<rounds;r++){const cards=ui(page).locator('#ehtw-shell .ehtw-tweet[data-ehtw-href]'),count=await cards.count(),visible=[];for(let i=0;i<count;i++){const card=cards.nth(i),box=await card.locator('.ehtw-tweet-title .glink').boundingBox();if(box&&box.y>=0&&box.y+box.height<=page.viewportSize().height)visible.push({href:await card.getAttribute('data-ehtw-href'),title:(await card.locator('.ehtw-tweet-title .glink').textContent()||'').trim(),box})}expect(visible.length,`at least three real card targets are visible in ${page.viewportSize().height}px viewport`).toBeGreaterThanOrEqual(3);const n=Math.min(3+r%3,visible.length),targets=Array.from({length:n},(_,i)=>visible[(r+i)%visible.length]);expect(new Set(targets.map(x=>x.href)).size).toBe(n);const last=new URL(targets.at(-1).href,origin).href;site.state.faults.push({name:`burst-b-${r}`,path:new URL(targets[0].href,origin).pathname,type:'fetch',delayMs:400,times:1});logOperation(testInfo,`${origin} F1b expected mouse targets=${JSON.stringify(targets.map(x=>x.href))} expectedLast=${last}`,page.url());await startClickCapture(page);const start=Date.now();for(const target of targets)await page.mouse.click(target.box.x+target.box.width/2,target.box.y+target.box.height/2);const elapsed=Date.now()-start;const actual=await finishClickCapture(page);logOperation(testInfo,`${origin} F1b actual mouse targets=${JSON.stringify(actual)} elapsed=${elapsed}ms`,page.url());
  expect(elapsed,`real mouse burst elapsed=${elapsed}ms targets=${JSON.stringify(targets.map(x=>x.href))} actual=${JSON.stringify(actual)}`).toBeLessThanOrEqual(50);expect(actual).toEqual(targets.map(x=>new URL(x.href,origin).href));await expectLastTarget(page,targets.map(x=>x.href),last);await settle(page);await checkInvariants(page,diagnostics,site,'ehtw-detail');expect(await page.locator('#gn').textContent()).toBe(targets.at(-1).title);expect(diagnostics.documentNavigations.length).toBe(docs);await page.goBack();await waitForRoute(page,`${origin}/`,'ehtw-list')
 }
 }
});

for(const origin of origins)test(`F2 Back during pending navigation ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const rounds=scale(1,60);await open(page,`${origin}/`);const docs=diagnostics.documentNavigations.length;
 for(let r=0;r<rounds;r++){const cards=ui(page).locator('#ehtw-shell .ehtw-tweet[data-ehtw-href]'),count=await cards.count();expect(count).toBeGreaterThan(0);const card=cards.nth(r%count),href=await card.getAttribute('data-ehtw-href'),target=new URL(href,page.url()),gid=Number(target.pathname.split('/')[2]);site.state.faults.push({name:`pending-${r}`,path:target.pathname,type:'fetch',delayMs:1000,times:1});await card.locator('.ehtw-tweet-title .glink').click();await page.goBack();await waitForRoute(page,u=>u.origin===origin&&u.pathname==='/','ehtw-list',null,15_000);await settle(page);logOperation(testInfo,`${origin} pending-back ${r+1} gid=${gid}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list');expect(diagnostics.documentNavigations.length).toBe(docs)}
});

for(const origin of origins)test(`F6 click after Back during navigation wins without retaining the abandoned route ${origin}`,async({page,site,diagnostics},testInfo)=>{
 await open(page,`${origin}/`);const docs=diagnostics.documentNavigations.length,galleries=site.state.galleries;
 const a=galleries[4],b=galleries[9];site.state.faults.push({name:'mixed-back-slow-a',path:`/g/${a.gid}/${a.token}/`,type:'fetch',delayMs:1200,times:1});
 await ui(page).locator(`.ehtw-tweet[data-ehtw-href="${origin}/g/${a.gid}/${a.token}/"] .ehtw-tweet-title .glink`).click();
 await expect.poll(()=>page.url()).toContain(`/g/${a.gid}/`);await page.goBack();
 expect(page.url()).toBe(`${origin}/`);
 await ui(page).locator(`.ehtw-tweet[data-ehtw-href="${origin}/g/${b.gid}/${b.token}/"] .ehtw-tweet-title .glink`).click({force:true});
 await waitForRoute(page,new RegExp(`/g/${b.gid}/${b.token}/$`),'ehtw-detail',null,15_000);await settle(page);
 expect(page.url()).toContain(`/g/${b.gid}/`);expect(await page.locator('#gn').textContent()).toBe(b.title);expect(diagnostics.documentNavigations.length).toBe(docs);
 await page.goBack();await waitForRoute(page,`${origin}/`,'ehtw-list');expect(diagnostics.documentNavigations.length).toBe(docs);
 await checkInvariants(page,diagnostics,site,'ehtw-list');
});

for(const origin of origins)test(`F7 click after Forward during navigation wins over the traversed route ${origin}`,async({page,site,diagnostics},testInfo)=>{
 await open(page,`${origin}/`);const docs=diagnostics.documentNavigations.length,galleries=site.state.galleries;
 const a=galleries[3],c=galleries[8];
 await ui(page).locator(`.ehtw-tweet[data-ehtw-href="${origin}/g/${a.gid}/${a.token}/"] .ehtw-tweet-title .glink`).click();
 await waitForRoute(page,new RegExp(`/g/${a.gid}/${a.token}/$`),'ehtw-detail');await page.goBack();await waitForRoute(page,`${origin}/`,'ehtw-list');
 site.state.faults.push({name:'mixed-forward-slow-a',path:`/g/${a.gid}/${a.token}/`,type:'fetch',delayMs:1200,times:1});
 await page.goForward();await expect.poll(()=>page.url()).toContain(`/g/${a.gid}/`);
 await page.waitForFunction(()=>document.documentElement.classList.contains('ehtw-navigation-pending'));
 await ui(page).locator(`.ehtw-tweet[data-ehtw-href="${origin}/g/${c.gid}/${c.token}/"] .ehtw-tweet-title .glink`).click({force:true});
 await waitForRoute(page,new RegExp(`/g/${c.gid}/${c.token}/$`),'ehtw-detail',null,15_000);await settle(page);
 expect(page.url()).toContain(`/g/${c.gid}/`);expect(await page.locator('#gn').textContent()).toBe(c.title);expect(diagnostics.documentNavigations.length).toBe(docs);
 await page.goBack();await waitForRoute(page,new RegExp(`/g/${a.gid}/${a.token}/$`),'ehtw-detail',null,15_000);expect(await page.locator('#gn').textContent()).toBe(a.title);expect(diagnostics.documentNavigations.length).toBe(docs);
 await checkInvariants(page,diagnostics,site,'ehtw-detail');
});

for(const origin of origins)test(`F3 Back five and Forward three in one task ${origin}`,async({page,site,diagnostics},testInfo)=>{
 await open(page,`${origin}/`);const docs=diagnostics.documentNavigations.length,walk=[['Watched',u=>u.pathname==='/watched','ehtw-list'],['Popular',u=>u.pathname==='/popular','ehtw-list'],['Toplists',u=>u.pathname==='/toplist.php','ehtw-enabled'],['Torrents',u=>u.pathname==='/torrents.php','ehtw-enabled'],['Favorites',u=>u.pathname==='/favorites.php','ehtw-enabled'],['My Home',u=>u.pathname==='/home.php','ehtw-enabled'],['News',u=>u.pathname==='/news.php','ehtw-enabled']];
 for(const [label,matcher,route]of walk)await navigate(page,async()=>tap(page,testInfo,await navEntry(page,testInfo,label)),matcher,route);
 expect(await page.evaluate(()=>history.length)).toBeGreaterThanOrEqual(8);
 for(let r=0;r<scale(1,60);r++){await page.evaluate(()=>{for(let i=0;i<5;i++)history.back();for(let i=0;i<3;i++)history.forward()});await settle(page);const route=await routeClassFromPage(page),state=await page.evaluate(()=>({url:location.href,className:document.documentElement.className}));logOperation(testInfo,`${origin} history back×5 forward×3 ${r+1}; state=${JSON.stringify(state)}`,page.url());await waitForRouteWithContext(page,u=>u.origin===origin,route,15_000);await checkInvariants(page,diagnostics,site,route);expect(diagnostics.documentNavigations.length).toBe(docs)}
});

for(const origin of origins)test(`F4 header navigation supersedes detail load ${origin}`,async({page,site,diagnostics},testInfo)=>{
 await open(page,`${origin}/`);const docs=diagnostics.documentNavigations.length;for(let r=0;r<scale(1,60);r++){if(new URL(page.url()).pathname!=='/'){await page.goBack();await waitForRoute(page,`${origin}/`,'ehtw-list');await settle(page)}const cards=ui(page).locator('#ehtw-shell .ehtw-tweet[data-ehtw-href]'),count=await cards.count();expect(count,`F4 iteration ${r+1} requires a list page; URL=${page.url()}`).toBeGreaterThan(0);const card=cards.nth(r%count),href=await card.getAttribute('data-ehtw-href'),target=new URL(href,page.url()),gid=Number(target.pathname.split('/')[2]);site.state.faults.push({name:`header-${r}`,path:target.pathname,type:'fetch',delayMs:1000,times:1});await card.locator('.ehtw-tweet-title .glink').click();await tap(page,testInfo,await navEntry(page,testInfo,'Front Page'));await page.waitForFunction(()=>!document.documentElement.classList.contains('ehtw-navigation-pending')&&!!document.querySelector('#ehtw-shell'),null,{timeout:15_000});await settle(page);const route=await routeClassFromPage(page),result=await page.evaluate(()=>({url:location.href,className:document.documentElement.className,title:document.querySelector('#gn')?.textContent||''}));const winner=result.url===`${origin}/`?'header route':result.url.includes('/g/')?'detail route':'other route';testInfo.annotations.push({type:'race-result',description:`F4 step ${r+1}: gid=${gid}; ${winner}; ${JSON.stringify(result)}`});logOperation(testInfo,`${origin} F4 ${winner} ${r+1}`,page.url());await checkInvariants(page,diagnostics,site,route);expect(diagnostics.documentNavigations.length).toBe(docs)}
});

for(const origin of origins)test(`F5 Back during reader image loading ${origin}`,async({page,site,diagnostics},testInfo)=>{
 await open(page,`${origin}/`);const docs=diagnostics.documentNavigations.length;site.state.slowImagesMs=400;for(let r=0;r<scale(1,60);r++){const cards=ui(page).locator('#ehtw-shell .ehtw-tweet[data-ehtw-href]'),count=await cards.count();expect(count).toBeGreaterThan(0);const card=cards.nth(r%count),href=await card.getAttribute('data-ehtw-href'),target=new URL(href,page.url()),gid=Number(target.pathname.split('/')[2]);await card.locator('.ehtw-tweet-title .glink').click();await waitForRoute(page,new RegExp(`/g/${gid}/`),'ehtw-detail');await ui(page).locator('#ehtw-shell a[href*="/s/"]').first().click();await page.goBack();await waitForRoute(page,new RegExp(`/g/${gid}/`),'ehtw-detail');await settle(page);logOperation(testInfo,`${origin} reader-back ${r+1} gid=${gid}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-detail');await page.goBack();await waitForRoute(page,u=>u.origin===origin&&u.pathname==='/','ehtw-list');logOperation(testInfo,`${origin} reader race back to list ${r+1}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-list');expect(diagnostics.documentNavigations.length).toBe(docs)}
 site.state.slowImagesMs=0;
});
