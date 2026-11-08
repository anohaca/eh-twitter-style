import { expect } from '@playwright/test';
import { expectNoHorizontalOverflow, EH, EX, ui, waitForRoute, tap } from '../e2e/harness.mjs';

// This document-start script only wraps native APIs and exposes counters.
export const PROBE_SCRIPT = `(() => {
  if (window.__ehtwProbe) return;
  const proto=EventTarget.prototype,nativeAdd=proto.addEventListener,nativeRemove=proto.removeEventListener;
  const NativeMO=window.MutationObserver;
  const p = window.__ehtwProbe = { ready:false, timers:{created:0,cleared:0,alive:new Map()}, raf:{created:0,cancelled:0,alive:new Set(),callbacks:0}, observers:{}, listeners:{}, network:{inflight:0,peak:0,created:0}, unhandled:[], classTimes:{} };
  const timerSet=window.setTimeout.bind(window),timerClear=window.clearTimeout.bind(window),intervalSet=window.setInterval.bind(window),intervalClear=window.clearInterval.bind(window);
  const timerMeta=new Map();
  window.setTimeout=function(fn,delay,...args){let id;const ms=Number(delay)||0,cb=typeof fn==='function'?function(...a){p.timers.alive.delete(id);timerMeta.delete(id);return fn.apply(this,a)}:fn;id=timerSet(cb,delay,...args);p.timers.created++;p.timers.alive.set(id,{kind:'timeout',due:performance.now()+Math.max(0,ms)});if(typeof fn!=='function'){const clean=timerSet(()=>{p.timers.alive.delete(id);timerMeta.delete(id)},delay);timerMeta.set(id,{cleanup:clean})}return id};
  window.setInterval=function(fn,delay,...args){const id=intervalSet(fn,delay,...args);p.timers.created++;p.timers.alive.set(id,{kind:'interval',due:Infinity});return id};
  window.clearTimeout=function(id){const meta=timerMeta.get(id);if(meta)timerClear(meta.cleanup);timerMeta.delete(id);p.timers.alive.delete(id);p.timers.cleared++;return timerClear(id)};
  window.clearInterval=function(id){p.timers.alive.delete(id);p.timers.cleared++;return intervalClear(id)};
  const raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame=function(cb){let id;id=raf(function(t){p.raf.alive.delete(id);p.raf.callbacks++;return cb.call(this,t)});p.raf.created++;p.raf.alive.add(id);return id};
  window.cancelAnimationFrame=function(id){p.raf.alive.delete(id);p.raf.cancelled++;return caf(id)};

  const observerRegistry=[];const observerInfo=new WeakMap();
  for(const name of ['MutationObserver','IntersectionObserver','ResizeObserver']){const Native=window[name];if(!Native)continue;p.observers[name]={created:0,disconnected:0};window[name]=class extends Native{constructor(...a){super(...a);const info={kind:name,active:true,targets:new Set(),targetSet:new WeakSet()};observerInfo.set(this,info);observerRegistry.push(new WeakRef(this));p.observers[name].created++}observe(target,...a){const info=observerInfo.get(this);const out=super.observe(target,...a);info.active=true;if(!info.targetSet.has(target)){info.targetSet.add(target);info.targets.add(new WeakRef(target))}return out}unobserve(target){const info=observerInfo.get(this),out=super.unobserve(target);if(info){info.targetSet.delete(target);info.targets=new Set([...info.targets].filter(r=>r.deref()!==target))}return out}disconnect(){const info=observerInfo.get(this),out=super.disconnect();if(info){info.active=false;info.targets.clear();info.targetSet=new WeakSet()}p.observers[name].disconnected++;return out}}}
  p.observerSnapshot=()=>{const out={};for(const name of Object.keys(p.observers)){let alive=0,targets=0;for(let i=observerRegistry.length-1;i>=0;i--){const observer=observerRegistry[i].deref();if(!observer){observerRegistry.splice(i,1);continue}const info=observerInfo.get(observer);if(!info||info.kind!==name)continue;if(info.active)alive++;for(const ref of [...info.targets]){const t=ref.deref();if(!t)info.targets.delete(ref);else targets++}}out[name]={...p.observers[name],alive,targets}}return out};

  const group=t=>t===window?'window':t===document?'document':(window.Element&&t instanceof Element?'element':null);
  const targetMaps=new WeakMap(),listenerRegistry=[];
  const getEntry=(target,type,listener,capture)=>targetMaps.get(target)?.get(type)?.get(listener)?.get(capture);
  const putEntry=(target,type,listener,capture,entry)=>{let a=targetMaps.get(target);if(!a)targetMaps.set(target,a=new Map());let b=a.get(type);if(!b)a.set(type,b=new Map());let c=b.get(listener);if(!c)b.set(listener,c=new Map());c.set(capture,entry)};
  const eraseEntry=(target,type,listener,capture)=>{const b=targetMaps.get(target)?.get(type)?.get(listener);if(!b)return;const entry=b.get(capture);if(!entry)return;b.delete(capture);entry.token.active=false;if(!b.size)targetMaps.get(target).get(type).delete(listener);if(!targetMaps.get(target).get(type).size)targetMaps.get(target).delete(type);if(entry.signal&&entry.abort)nativeRemove.call(entry.signal,'abort',entry.abort,false)};
  const cachedOptions=(options)=>{if(options===undefined||options===null||typeof options==='boolean')return{value:options,cache:{}};const cache={};return{value:new Proxy(options,{get(target,key){if(Object.hasOwn(cache,key))return cache[key];const v=Reflect.get(target,key,target);cache[key]=v;return v}}),cache}};
  proto.addEventListener=function(type,listener,options){const category=group(this);if(!category||listener==null)return nativeAdd.call(this,type,listener,options);const packed=cachedOptions(options),opts=packed.value,capture=typeof options==='boolean'?options:!!opts?.capture;const prior=getEntry(this,type,listener,capture);if(prior)return nativeAdd.call(this,type,prior.wrapped||listener,opts);const once=!!opts?.once;const weakTarget=new WeakRef(this),weakListener=new WeakRef(listener),token={active:true};let wrapped=listener;
    if(once)wrapped=function(event){const target=weakTarget.deref(),original=weakListener.deref();if(target&&original)eraseEntry(target,type,original,capture);if(typeof original==='function')return original.call(this,event);return original?.handleEvent?.call(original,event)};
    const out=nativeAdd.call(this,type,wrapped,opts);const signal=packed.cache.signal;if(signal&&signal.aborted){return out}const entry={wrapped,signal:signal||null,abort:null,token};putEntry(this,type,listener,capture,entry);listenerRegistry.push({target:weakTarget,category,type:String(type),token});
    if(signal){entry.abort=()=>{const target=weakTarget.deref(),original=weakListener.deref();if(target&&original)eraseEntry(target,type,original,capture)};nativeAdd.call(signal,'abort',entry.abort,{once:true})}return out};
  proto.removeEventListener=function(type,listener,options){const capture=typeof options==='boolean'?options:!!options?.capture,entry=getEntry(this,type,listener,capture);const out=nativeRemove.call(this,type,entry?.wrapped||listener,capture);if(entry)eraseEntry(this,type,listener,capture);return out};
  p.listenerSnapshot=()=>{const counts={window:0,document:0,element:0,elementConnected:0,elementDetached:0},byType={window:{},document:{},element:{}},byTypeConnected={},byTypeDetached={};for(let i=listenerRegistry.length-1;i>=0;i--){const r=listenerRegistry[i],t=r.target.deref();if(!t||!r.token.active){listenerRegistry.splice(i,1);continue}counts[r.category]++;byType[r.category][r.type]=(byType[r.category][r.type]||0)+1;if(r.category==='element'){const connected=t.isConnected,map=connected?byTypeConnected:byTypeDetached;map[r.type]=(map[r.type]||0)+1;if(connected)counts.elementConnected++;else counts.elementDetached++}}return{...counts,byType,byTypeConnected,byTypeDetached}};

  const nativeFetch=window.fetch,finish=()=>{p.network.inflight=Math.max(0,p.network.inflight-1)};if(nativeFetch)window.fetch=function(...a){p.network.created++;p.network.inflight++;p.network.peak=Math.max(p.network.peak,p.network.inflight);let result;try{result=nativeFetch.apply(this,a)}catch(e){finish();throw e}return Promise.resolve(result).then(v=>{finish();return v},e=>{finish();throw e})};
  const XHR=window.XMLHttpRequest;if(XHR)window.XMLHttpRequest=class extends XHR{send(...a){p.network.created++;p.network.inflight++;p.network.peak=Math.max(p.network.peak,p.network.inflight);let done=false;const end=()=>{if(!done){done=true;finish()}};nativeAdd.call(this,'loadend',end,{once:true});try{return super.send(...a)}catch(e){end();throw e}}};
  if(NativeMO){const mo=new NativeMO(records=>{for(const r of records){if(r.type!=='attributes'||r.target!==document.documentElement)continue;const now=performance.now();for(const c of ['ehtw-navigation-pending','ehtw-page-boot','ehtw-reader-boot']){if(document.documentElement.classList.contains(c)){if(p.classTimes[c]===undefined)p.classTimes[c]=now}else delete p.classTimes[c]}}});mo.observe(document,{subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['class']})}
  nativeAdd.call(window,'unhandledrejection',e=>p.unhandled.push(String(e.reason?.stack||e.reason)));
  p.rafSnapshot=()=>({created:p.raf.created,cancelled:p.raf.cancelled,alive:p.raf.alive.size,callbacks:p.raf.callbacks});
  p.ready=true;
})();`;

export const scale = (quick, full) => process.env.EHTW_STABILITY === 'full' ? full : quick;
export const origins = [EH, EX];
const runData = new WeakMap();
const activeInfo = new WeakMap();

export function initializeRun(test, testInfo) {
  let seed = Number(process.env.EHTW_SEED);
  if (!Number.isFinite(seed)) seed = (Math.random() * 0x1_0000_0000) >>> 0;
  seed >>>= 0;
  const data = { seed, operations: [], samples: [], startedAt: new Date().toISOString() };
  runData.set(testInfo, data);
  testInfo.annotations.push({ type: 'EHTW_SEED', description: String(seed) });
  console.log(`[stability] EHTW_SEED=${seed} test=${testInfo.title}`);
  testInfo.outputPath('stability.json');
  return data;
}

export function dataFor(testInfo) { return runData.get(testInfo); }
export function classifyKnownIssue(error,matcher){if(!error)return'no-longer-reproduces';return matcher(error)?'expected-fail':'real-fail'}
export async function knownIssue(testInfo,id,matcher,body){let failure=null;try{await body()}catch(error){failure=error}const outcome=classifyKnownIssue(failure,matcher);if(outcome==='expected-fail'){testInfo.fail(true,`${id}: reproduced known issue`);throw failure}if(outcome==='real-fail')throw failure;throw new Error(`${id} no longer reproduces; remove the known-issue marker`)}
export async function navEntry(page,testInfo,label){const link=ui(page).locator('#ehtw-left #nb a',{hasText:new RegExp(`^\\s*${label}\\s*$`)}).first();if(!(await link.isVisible())){const more=ui(page).locator('.ehtw-more-button');if(await more.isVisible())await tap(page,testInfo,more)}await expect(link).toBeVisible();return link}
export function nextListPageLink(page){return ui(page).locator('.ehtw-pagination .searchnav a[href*="page=1"], .ptt a[href*="p=1"]').first()}
export async function routeClassFromPage(page){return page.evaluate(()=>{const c=[...document.documentElement.classList];return ['ehtw-detail','ehtw-reader','ehtw-list','ehtw-generic','ehtw-other','ehtw-bounty','ehtw-myhome','ehtw-mytags'].find(x=>c.includes(x))||null})}
export async function liveTimeoutIds(page){return page.evaluate(()=>[...window.__ehtwProbe.timers.alive.entries()].filter(([,timer])=>timer.kind==='timeout').map(([id])=>id))}
export async function waitForNewTimeoutsToDrain(page,baselineIds,timeout=32_000){await expect.poll(()=>page.evaluate(ids=>{const baseline=new Set(ids);return [...window.__ehtwProbe.timers.alive.entries()].filter(([id,timer])=>!baseline.has(id)&&timer.kind==='timeout').map(([id,timer])=>({id,remainingMs:Math.max(0,Math.round(timer.due-performance.now()))}))},baselineIds),{timeout,intervals:[50,100,200,500]}).toEqual([])}
export async function waitForRouteWithContext(page,urlMatcher,cls,timeout=15_000){const readState=()=>page.evaluate(()=>({url:location.href,className:document.documentElement?.className||'',pending:document.documentElement?.classList.contains('ehtw-navigation-pending'),boot:document.documentElement?.classList.contains('ehtw-page-boot'),spaReady:window.__EHTW_SPA_READY__,shells:document.querySelectorAll('#ehtw-shell').length,headers:document.querySelectorAll('#ehtw-header').length,backLinks:document.querySelectorAll('#ehtw-header .ehtw-back-link').length,readerReady:!!document.querySelector('.ehtw-reader-root[data-ehtw-reader-ready="true"]')}));const retryContext=async error=>{if(!/Execution context was destroyed/i.test(String(error?.message||error)))throw error;await page.waitForLoadState('domcontentloaded',{timeout}).catch(loadError=>{if(!/Timeout/i.test(String(loadError?.message||loadError)))throw loadError});return readState()};let state,stage='read initial state';try{state=await readState()}catch(error){state=await retryContext(error)}if(!cls)throw new Error(`No supported route class after navigation; current state=${JSON.stringify(state)}`);try{if(cls instanceof RegExp){const matchesUrl=href=>{try{const url=new URL(href);if(typeof urlMatcher==='function')return !!urlMatcher(url);if(urlMatcher instanceof RegExp)return urlMatcher.test(href);return href===String(urlMatcher)}catch{return false}};stage='wait for destination URL';await expect.poll(()=>matchesUrl(page.url()),{timeout,intervals:[50,100,200]}).toBe(true);stage='wait for final matching html class';const matched=await page.waitForFunction(({source,flags})=>{const root=document.documentElement;if(!root||root.classList.contains('ehtw-navigation-pending')||root.classList.contains('ehtw-page-boot')||window.__EHTW_SPA_READY__===false)return false;const pattern=new RegExp(source,flags);return [...root.classList].find(name=>pattern.test(name))||false},{source:cls.source,flags:cls.flags},{timeout,polling:50});cls=await matched.jsonValue();}stage=`waitForRoute rendered state for ${cls}`;return await waitForRoute(page,urlMatcher,cls,null,timeout)}catch(error){let current;try{current=await readState()}catch(contextError){current=await retryContext(contextError)}throw new Error(`${error.message}\nfailed stage=${stage}\ncurrent route state=${JSON.stringify(current)}`)}}
export function randomFor(seed) {
  let a = seed >>> 0;
  const fn = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  fn.int = (max) => Math.floor(fn() * max);
  return fn;
}

export function logOperation(testInfo, action, url, ms = 0) {
  const data = dataFor(testInfo); if (!data) return;
  data.operations.push({ i: data.operations.length + 1, action, url, ms });
}

export async function snapshot(page) {
  // Capture TaskDuration, collect garbage, and read heap/DOM metrics before
  // dereferencing any WeakRefs in the page realm.
  const cdp = await cdpMetrics(page);
  const browserData = await page.evaluate(() => {
    const p=window.__ehtwProbe;if(!p?.ready)throw new Error('stability probe is missing or did not finish installing');
    const storage=(s)=>{let keys=0,bytes=0;try{for(let i=0;i<s.length;i++){const k=s.key(i)||'',v=s.getItem(k)||'';if(/ehtw/i.test(k)){keys++;bytes+=(k.length+v.length)*2}}}catch{}return{keys,bytes}};
    const safeStorage=(name)=>{try{return storage(window[name])}catch{return{keys:0,bytes:0}}};
    const hosts=[...document.documentElement.children].filter(e=>e.shadowRoot).length;
    const now=performance.now(),timerValues=[...p.timers.alive.values()];return {url:location.href,now,classes:[...document.documentElement.classList],shell:document.querySelectorAll('#ehtw-shell').length,header:document.querySelectorAll('#ehtw-header').length,backLinks:document.querySelectorAll('#ehtw-header .ehtw-back-link').length,readerRoots:document.querySelectorAll('.ehtw-reader-root').length,suspendedHosts:hosts,tweets:document.querySelectorAll('.ehtw-tweet').length,domNodes:document.getElementsByTagName('*').length,localStorage:safeStorage('localStorage'),sessionStorage:safeStorage('sessionStorage'),timers:{created:p.timers.created,cleared:p.timers.cleared,alive:timerValues.map(x=>x.kind),intervals:timerValues.filter(x=>x.kind==='interval').length,timeouts:timerValues.filter(x=>x.kind==='timeout'&&x.due<=now).length},raf:p.rafSnapshot(),observers:p.observerSnapshot(),listeners:p.listenerSnapshot(),network:p.network,unhandled:p.unhandled,classTimes:p.classTimes};
  });
  const testInfo=activeInfo.get(page),info=dataFor(testInfo),images=info?.imageNetwork||{inflight:0,peak:0,created:0},readerImages=info?.readerImageNetwork||{inflight:0,peak:0,created:0,peakUrls:[],preloadInflight:0,preloadPeak:0,preloadPeakUrls:[],preloadPeakDetails:[]};
  return { ...browserData, network:{...browserData.network,images,readerImages}, cdp };
}

const cdpSessions=new WeakMap();
export async function cdpMetrics(page) {
  if (page.context().browser()?.browserType().name() !== 'chromium') return null;
  let session=cdpSessions.get(page);if(!session){session=await page.context().newCDPSession(page);await session.send('Performance.enable');cdpSessions.set(page,session)}
  const before=await session.send('Performance.getMetrics');await session.send('HeapProfiler.collectGarbage');const after=await session.send('Performance.getMetrics');
  const first=Object.fromEntries(before.metrics.map(x=>[x.name,x.value])),last=Object.fromEntries(after.metrics.map(x=>[x.name,x.value]));const out={};
  for(const k of ['JSHeapUsedSize','Nodes','JSEventListeners','Documents']){if(!Number.isFinite(last[k]))throw new Error(`CDP metric unavailable: ${k}`);out[k]=last[k]}
  if(!Number.isFinite(first.TaskDuration))throw new Error('CDP metric unavailable: TaskDuration');out.TaskDuration=first.TaskDuration;
  if(out.JSHeapUsedSize<=0||out.Nodes<=0||out.Documents<=0)throw new Error(`CDP metrics must be positive: ${JSON.stringify(out)}`);return out;
}

export async function checkInvariants(page, diagnostics, site, expectedRoute) {
  const s=await snapshot(page), failures=[];
  const check=(ok,msg)=>{if(!ok)failures.push(msg)};
  const isReader=s.classes.includes('ehtw-reader');if(isReader){check(s.shell===0,'reader #ehtw-shell count');check(s.readerRoots===1,'reader root count')}else{check(s.shell===1,'#ehtw-shell count');check(s.header===1,'#ehtw-header count');check(s.backLinks<=1,'.ehtw-back-link count')}
  check(s.suspendedHosts<=3,'suspended SPA host bound');
  const url=new URL(s.url), route=routeFor(url);if(route instanceof RegExp)check(route.test(s.classes.join(' ')),`route class ${route} vs ${url.pathname}`);else if(route)check(s.classes.includes(route),`route class ${route} vs ${url.pathname}`);
  if(expectedRoute)check(routeMatches(route,s.classes,expectedRoute),`expected route ${expectedRoute}, got ${s.classes.join(' ')}`);
  if(url.pathname.startsWith('/g/')) {const gid=Number(url.pathname.split('/')[2]);const gallery=site.state.galleries.find(g=>g.gid===gid);const title=await ui(page).locator('#gn').first().textContent(),normalize=value=>String(value||'').replace(/\s+/g,' ').trim(),actual=normalize(title),expected=normalize(gallery?.title);check(!!gallery&&actual===expected,`detail title mismatch gid=${gid}; actual=${JSON.stringify(title)} normalized=${JSON.stringify(actual)} expected=${JSON.stringify(gallery?.title)} normalizedExpected=${JSON.stringify(expected)}`)}
  if(route==='ehtw-list'){const hrefs=await ui(page).locator('[data-ehtw-href]').evaluateAll(es=>es.map(e=>e.getAttribute('data-ehtw-href')));check(new Set(hrefs).size===hrefs.length,'duplicate data-ehtw-href')}
  if(diagnostics.pageErrors.length)failures.push(`pageErrors=${JSON.stringify(diagnostics.pageErrors)}`);const scriptConsoleErrors=diagnostics.consoleErrors.filter(e=>/ehtw|userscript/i.test(e));if(scriptConsoleErrors.length)failures.push(`userscript consoleErrors=${JSON.stringify(scriptConsoleErrors)}`);if(s.unhandled.length)failures.push(`unhandledrejection=${JSON.stringify(s.unhandled)}`);check(await page.evaluate(()=>window.__ehtwXss)===undefined,'window.__ehtwXss defined');check(site.state.writes.length===0,'mock site writes present');
  check(!Object.entries(s.classTimes).some(([c,t])=>s.now-t>8000), 'boot/pending class survived >8s');
  try { await expectNoHorizontalOverflow(page, 'stability invariant'); } catch(e) { failures.push(`horizontal overflow: ${e.message}`); }
  const info=activeInfo.get(page),d=dataFor(info);if(d){d.samples.push({at:Date.now(),snapshot:s});}
  if(failures.length){const ops=d?.operations.slice(-20)||[];throw new Error(`${failures.join('; ')}\nrecent operations=${JSON.stringify(ops)}\nsnapshot=${JSON.stringify(s)}`)}
  return s;
}

export function installRunHooks(test) {
  test.beforeEach(async ({ page }, testInfo) => { const data=initializeRun(test,testInfo);activeInfo.set(page,testInfo);const active=new Set(),activeReader=new Map(),activeReaderPreload=new Map();data.imageNetwork={inflight:0,peak:0,created:0};data.readerImageNetwork={inflight:0,peak:0,created:0,peakUrls:[],preloadInflight:0,preloadPeak:0,preloadPeakUrls:[],preloadPeakDetails:[]};data.requestTimes=[];data.requestRecords=[];page.on('request',r=>{const record={at:Date.now(),url:r.url(),type:r.resourceType(),method:r.method(),readerTarget:data.readerTarget?{...data.readerTarget}:null,readerPosition:data.readerPosition?{...data.readerPosition}:null};data.requestTimes.push(record.at);data.requestRecords.push(record);if(r.resourceType()==='image'){active.add(r);data.imageNetwork.inflight++;data.imageNetwork.created++;data.imageNetwork.peak=Math.max(data.imageNetwork.peak,data.imageNetwork.inflight);let path='';try{path=new URL(r.url()).pathname}catch{}if(path.startsWith('/h/')){activeReader.set(r,r.url());const m=data.readerImageNetwork;m.inflight++;m.created++;if(m.inflight>m.peak){m.peak=m.inflight;m.peakUrls=[...activeReader.values()]}const requested=path.match(/^\/h\/(\d+)-(\d+)\//),targets=[data.readerTarget,data.readerPosition].filter(Boolean),isCurrent=!!requested&&targets.some(target=>Number(requested[1])===target.gid&&Number(requested[2])===target.page);if(!isCurrent){activeReaderPreload.set(r,{url:r.url(),readerTarget:data.readerTarget?{...data.readerTarget}:null,readerPosition:data.readerPosition?{...data.readerPosition}:null});m.preloadInflight++;if(m.preloadInflight>m.preloadPeak){m.preloadPeak=m.preloadInflight;m.preloadPeakDetails=[...activeReaderPreload.values()];m.preloadPeakUrls=m.preloadPeakDetails.map(item=>item.url)}}}}});const done=r=>{if(active.delete(r))data.imageNetwork.inflight=Math.max(0,data.imageNetwork.inflight-1);if(activeReader.delete(r))data.readerImageNetwork.inflight=Math.max(0,data.readerImageNetwork.inflight-1);if(activeReaderPreload.delete(r))data.readerImageNetwork.preloadInflight=Math.max(0,data.readerImageNetwork.preloadInflight-1)};page.on('requestfinished',done);page.on('requestfailed',done); });
  test.afterEach(async ({}, testInfo) => {
    const data=dataFor(testInfo);if(!data)return;
    data.sequence=data.operations.map(({action,url})=>({action,url}));
    data.durationMs=Date.now()-Date.parse(data.startedAt);data.finishedAt=new Date().toISOString();
    await testInfo.attach('stability.json',{body:JSON.stringify(data,null,2),contentType:'application/json'});
  });
}

// maxSlopePerStep is measured against actual xKey step values, not sample ordinal.
export function assertBounded(samples,key,{warmup=2,maxSlopePerStep,maxAbs,xKey=null}) {
  const selected=samples.slice(warmup),values=selected.map(s=>typeof key==='function'?key(s):key.split('.').reduce((a,k)=>a?.[k],s));
  if(!values.length)return{values:[],x:[],slope:0,max:-Infinity};
  const xs=selected.map((s,i)=>xKey===null?i:(typeof xKey==='function'?xKey(s):xKey.split('.').reduce((a,k)=>a?.[k],s)));
  const n=values.length,xm=xs.reduce((a,b)=>a+b,0)/n,ym=values.reduce((a,b)=>a+b,0)/n;let num=0,den=0;
  values.forEach((y,i)=>{num+=(xs[i]-xm)*(y-ym);den+=(xs[i]-xm)**2});const slope=den?num/den:0,max=Math.max(...values);
  expect(slope,`slope per step ${key}; x=${JSON.stringify(xs)}; sequence=${JSON.stringify(values)}`).toBeLessThanOrEqual(maxSlopePerStep);
  expect(max,`max ${key}; sequence=${JSON.stringify(values)}`).toBeLessThanOrEqual(maxAbs);
  return{values,x:xs,slope,max};
}

export function routeFor(url){const p=url.pathname;if(p.startsWith('/g/'))return'ehtw-detail';if(p.startsWith('/s/'))return'ehtw-reader';if(p==='/'||p==='/watched'||p==='/popular'||p.startsWith('/tag/')||p.startsWith('/uploader/')||p.startsWith('/?'))return'ehtw-list';if(p==='/favorites.php')return/ehtw-(list|generic|other)/;if(p==='/toplist.php')return/ehtw-(list|generic)/;if(p==='/news.php')return'ehtw-generic';if(p==='/torrents.php')return/ehtw-(generic|other)/;if(p==='/bounty.php')return/ehtw-(bounty|generic|other)/;if(['/home.php','/uconfig.php','/stats.php','/hentaiathome.php','/bitcoin.php','/hathperks.php','/exchange.php','/logs.php'].includes(p))return/ehtw-(myhome|generic)/;if(p==='/mytags')return/ehtw-(mytags|myhome|generic)/;return null}
function routeMatches(expected,classes,actual){if(expected instanceof RegExp)return expected.test(classes.join(' '));return classes.includes(actual)}
