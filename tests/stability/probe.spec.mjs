import {test,expect,buildInitScript} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,installRunHooks,cdpMetrics,assertBounded,snapshot,classifyKnownIssue} from './probe.mjs';

test.describe('probe API self tests',()=>{
 test.use({injectScript:false,preInitScript:PROBE_SCRIPT});installRunHooks(test);
 test('known-issue classifier distinguishes expected, unexpected, and vanished failures',async()=>{
  const matcher=error=>error?.knownIssueData?.kind==='specific-known-case';
  expect(classifyKnownIssue({knownIssueData:{kind:'specific-known-case'}},matcher)).toBe('expected-fail');
  expect(classifyKnownIssue({knownIssueData:{kind:'different-error'}},matcher)).toBe('real-fail');
  expect(classifyKnownIssue(null,matcher)).toBe('no-longer-reproduces');
 });
 test('listener options preserve Web API behavior and counters',async({page})=>{
  await page.goto('data:text/html,<html><body><div id="target"></div></body></html>');
  const result=await page.evaluate(()=>{const p=window.__ehtwProbe,t=document.querySelector('#target'),calls={signal:0};const fn=k=>()=>calls[k]=(calls[k]||0)+1;const plain=fn('undefined');
   t.addEventListener('undefined',plain,undefined);t.addEventListener('boolean',fn('boolean'),true);t.addEventListener('once',fn('once'),{once:true});const c1=new AbortController();t.addEventListener('signal',fn('signal'),{signal:c1.signal});const c2=new AbortController();t.addEventListener('once-signal',fn('once-signal'),{once:true,signal:c2.signal});t.addEventListener('signal-undefined',fn('signal-undefined'),{signal:undefined});const handle={handleEvent(){calls.object=(calls.object||0)+1}};t.addEventListener('object',handle);
   const duplicate=fn('duplicate');t.addEventListener('duplicate',duplicate);t.addEventListener('duplicate',duplicate);
   const before=p.listenerSnapshot().element;c1.abort();const afterAbort=p.listenerSnapshot().element;
   for(const type of ['undefined','boolean','once','signal','once-signal','signal-undefined','object','duplicate']){t.dispatchEvent(new Event(type));t.dispatchEvent(new Event(type))}const after=p.listenerSnapshot().element;c2.abort();const afterOnceSignal=p.listenerSnapshot().element;
   t.removeEventListener('undefined',plain);const afterRemove=p.listenerSnapshot().element;return{calls,before,afterAbort,after,afterOnceSignal,afterRemove,final:p.listenerSnapshot().element}
  });
  expect(result.calls).toMatchObject({undefined:2,boolean:2,once:1,signal:0,'once-signal':1,'signal-undefined':2,object:2,duplicate:2});expect(result.before).toBe(8);expect(result.afterAbort).toBe(result.before-1);expect(result.afterOnceSignal).toBeLessThan(result.afterAbort);expect(result.afterRemove).toBe(result.final);expect(result.final).toBeGreaterThanOrEqual(0);
 });
 test('interval survives repeated ticks; timeout expires; clear removes interval',async({page})=>{
  await page.goto('data:text/html,<html><body></body></html>');const ids=await page.evaluate(()=>{window.__ticks=0;const interval=setInterval(()=>window.__ticks++,10);const timeout=setTimeout(()=>window.__timeoutFired=true,30);return{interval,timeout}});
  await page.waitForFunction(()=>window.__ticks>=3,null,{timeout:5000});let timers=await page.evaluate(id=>({interval:window.__ehtwProbe.timers.alive.get(id)?.kind==='interval'}),ids.interval);expect(timers.interval).toBe(true);
  await page.waitForFunction(()=>window.__timeoutFired===true,null,{timeout:5000});timers=await page.evaluate(({id,timeout})=>({interval:window.__ehtwProbe.timers.alive.has(id),timeout:window.__ehtwProbe.timers.alive.has(timeout)}),{id:ids.interval,timeout:ids.timeout});expect(timers.timeout).toBe(false);await page.evaluate(id=>clearInterval(id),ids.interval);timers=await page.evaluate(id=>window.__ehtwProbe.timers.alive.has(id),ids.interval);expect(timers).toBe(false);
 });
 test('rAF and all available observers track create, targets, disconnect, and weak cleanup',async({page})=>{
  await page.goto('data:text/html,<html><body><div id="target"></div></body></html>');await page.evaluate(()=>{window.__rafId=requestAnimationFrame(()=>window.__rafDone=true);cancelAnimationFrame(window.__rafId);window.__observers=[];for(const name of ['MutationObserver','IntersectionObserver','ResizeObserver'])if(window[name]){const o=new window[name](()=>{});if(name==='MutationObserver')o.observe(document.querySelector('#target'),{childList:true});else o.observe(document.querySelector('#target'));window.__observers.push({name,ref:new WeakRef(o)})}});
  const before=await page.evaluate(()=>({raf:window.__ehtwProbe.rafSnapshot(),observers:window.__ehtwProbe.observerSnapshot()}));expect(before.raf.alive).toBe(0);expect(before.raf.created).toBe(1);expect(before.raf.cancelled).toBe(1);for(const name of ['MutationObserver','IntersectionObserver','ResizeObserver'])if(before.observers[name]){expect(before.observers[name].alive).toBeGreaterThan(0);expect(before.observers[name].targets).toBeGreaterThan(0)}
  await page.evaluate(()=>{for(const x of window.__observers)x.ref.deref()?.disconnect();const e=document.querySelector('#target');e.addEventListener('x',()=>{});window.__connectedElementCounts=window.__ehtwProbe.listenerSnapshot();e.remove();window.__detachedElementCounts=window.__ehtwProbe.listenerSnapshot();window.__detachedElement=new WeakRef(e)});const after=await page.evaluate(()=>({observers:window.__ehtwProbe.observerSnapshot(),connected:window.__connectedElementCounts,detached:window.__detachedElementCounts}));for(const value of Object.values(after.observers)){expect(value.disconnected).toBeGreaterThan(0);expect(value.targets).toBe(0)}expect(after.connected.elementConnected).toBe(1);expect(after.detached.element).toBe(1);expect(after.detached.elementConnected).toBe(0);
  await cdpMetrics(page);await expect.poll(()=>page.evaluate(()=>window.__ehtwProbe.listenerSnapshot().element)).toBe(0);expect(await page.evaluate(()=>window.__detachedElement.deref())).toBeUndefined();
 });
 test('Chromium metrics are present and positive; bounded-growth helper detects linear growth',async({page})=>{
  await page.goto('data:text/html,<html><body>metric sample</body></html>');const metrics=await cdpMetrics(page);expect(metrics).not.toBeNull();for(const value of Object.values(metrics))expect(value).toBeGreaterThan(0);
  expect(()=>assertBounded([0,1,2,3,4,5],x=>x,{warmup:0,maxSlopePerStep:.5,maxAbs:10})).toThrow();assertBounded([1,1,1,1,1],x=>x,{warmup:0,maxSlopePerStep:.5,maxAbs:10});
  const byStep=assertBounded([{step:10,value:30},{step:40,value:120},{step:80,value:240}],x=>x.value,{warmup:0,xKey:'step',maxSlopePerStep:3.01,maxAbs:500});expect(byStep.slope).toBeCloseTo(3,8);
 });
 test('repeated probe snapshots do not increase Chromium DOM Nodes',async({page})=>{
  await page.goto('data:text/html,<html><body><div>snapshot baseline</div></body></html>');const before=await cdpMetrics(page);for(let i=0;i<8;i++)await snapshot(page);const after=await cdpMetrics(page);expect(after.Nodes,`DOM Nodes before=${before.Nodes} after=${after.Nodes} across eight snapshots`).toBeLessThanOrEqual(before.Nodes);
 });
});

test.describe('probe observational equivalence',()=>{
 test.use({injectScript:true,preInitScript:PROBE_SCRIPT});installRunHooks(test);
 test('mock home class and tweet count match without the probe',async({page,browser,site,diagnostics})=>{
  const errors=[],plain=await browser.newContext();await plain.route('**/*',async route=>{const request=route.request(),url=request.url();if(url.startsWith('data:')||url.startsWith('blob:'))return route.continue();const response=site.handle({url,method:request.method(),type:request.resourceType(),referer:request.headers().referer||'',body:request.postData()||'',contentType:(await request.allHeaders())['content-type']||''});if(!response)return route.abort('blockedbyclient');return route.fulfill({status:response.status,headers:response.headers,body:response.body})});await plain.addInitScript(buildInitScript());const baseline=await plain.newPage();baseline.on('pageerror',e=>errors.push(String(e)));await baseline.goto('https://e-hentai.org/',{waitUntil:'load'});await baseline.locator('html.ehtw-list').waitFor({state:'attached',timeout:15_000});
  await page.goto('https://e-hentai.org/',{waitUntil:'load'});await page.locator('html.ehtw-list').waitFor({state:'attached',timeout:15_000});const observed=await snapshot(page),ordinary=await baseline.evaluate(()=>({classes:[...document.documentElement.classList],tweets:document.querySelectorAll('.ehtw-tweet').length}));expect(observed.classes).toEqual(ordinary.classes);expect(observed.tweets).toBe(ordinary.tweets);expect(errors).toEqual([]);expect(diagnostics.pageErrors).toEqual([]);await plain.close();
 });
});
