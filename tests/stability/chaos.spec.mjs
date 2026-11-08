import {test,expect,ui,open,waitForRoute,settle} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,scale,origins,randomFor,installRunHooks,checkInvariants,logOperation,dataFor} from './probe.mjs';
test.use({preInitScript:PROBE_SCRIPT});installRunHooks(test);
async function settleAcrossDocumentNavigation(page){let lastError;for(let attempt=0;attempt<3;attempt++){try{await settle(page);return}catch(error){if(!/Execution context was destroyed|Target page, context or browser has been closed/i.test(String(error?.message||error)))throw error;lastError=error;await page.waitForLoadState('domcontentloaded',{timeout:15_000})}}throw lastError}
for(const origin of origins)test(`E seeded navigation fault chaos ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const rng=randomFor(dataFor(testInfo).seed),steps=scale(8,400),statuses=[500,502,503,429,404];await open(page,`${origin}/`);
 const cls=()=>new URL(page.url()).pathname.startsWith('/g/')?'ehtw-detail':new URL(page.url()).pathname.startsWith('/s/')?'ehtw-reader':'ehtw-list';
 for(let i=0;i<steps;i++){
  const beforeClass=cls(),inject=rng()<.3;let target,action;
  if(beforeClass==='ehtw-list'){const cards=ui(page).locator('#ehtw-shell .ehtw-tweet[data-ehtw-href]'),count=await cards.count();expect(count,`no gallery cards on current list URL ${page.url()}`).toBeGreaterThan(0);const card=cards.nth(rng.int(count)),href=await card.getAttribute('data-ehtw-href'),galleryUrl=new URL(href,page.url());target=galleryUrl.pathname+galleryUrl.search;action=async()=>card.locator('.ehtw-tweet-title .glink').click()}
  else if(beforeClass==='ehtw-reader'){const gid=Number(new URL(page.url()).pathname.match(/\/(\d+)-\d+$/)?.[1]),current=site.state.galleries.find(x=>x.gid===gid);target=`/g/${current.gid}/${current.token}/`;action=async()=>page.goBack()}
  else if(inject||rng()<.45){const gid=Number(new URL(page.url()).pathname.split('/')[2]),current=site.state.galleries.find(x=>x.gid===gid);target=site.readerUrl(origin,current,1).replace(origin,'');action=async()=>ui(page).locator('#ehtw-shell a[href*="/s/"]').first().click()}
  else {target='/';action=async()=>page.goBack()}
  const hitCount=site.state.faultHits.length,pathname=new URL(target,origin).pathname,faultInjected=inject&&(pathname.startsWith('/g/')||pathname==='/');
  if(faultInjected){const allowedServes=pathname.startsWith('/g/')?['list','redirect','unsupported']:['gallery'];site.state.faults.push({name:`chaos-${i}`,path:target,type:'fetch',status:statuses[rng.int(statuses.length)],delayMs:rng.int(4001),serve:allowedServes[rng.int(allowedServes.length)],times:1})}
  await action();logOperation(testInfo,`${origin} chaos attempt ${i+1} target=${target} injected=${faultInjected}`,`${origin}${target}`);await settleAcrossDocumentNavigation(page);const currentClass=cls();await waitForRoute(page,u=>u.href===page.url(),currentClass,null,15_000);
  if(faultInjected)expect(site.state.faultHits.length).toBeGreaterThan(hitCount);
  expect(diagnostics.pageErrors,`pageerror at chaos step ${i+1}`).toEqual([]);
  logOperation(testInfo,`${origin} chaos ${i+1} ${beforeClass}→${currentClass} injected=${faultInjected}`,page.url());await checkInvariants(page,diagnostics,site,currentClass);
 }
 site.state.faults.length=0;
 for(let i=0;i<10;i++){if(cls()==='ehtw-list'){const card=ui(page).locator('#ehtw-shell .ehtw-tweet[data-ehtw-href]').nth(i%site.state.galleries.length);await card.locator('.ehtw-tweet-title .glink').click();await waitForRoute(page,u=>u.href===page.url(),'ehtw-detail')}else await page.goBack();await settle(page);const current=cls();await waitForRoute(page,u=>u.href===page.url(),current);logOperation(testInfo,`${origin} normal recovery ${i+1}`,page.url());await checkInvariants(page,diagnostics,site,current)}
});
