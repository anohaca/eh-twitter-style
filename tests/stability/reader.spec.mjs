import {test,expect,ui,open,settle,tap,isTouch,EH,EX} from '../e2e/harness.mjs';
import {PROBE_SCRIPT,scale,origins,installRunHooks,checkInvariants,snapshot,logOperation,dataFor} from './probe.mjs';
import {THRESHOLDS} from './thresholds.mjs';

test.use({preInitScript:PROBE_SCRIPT,siteOptions:{slowImagesMs:400}});
installRunHooks(test);

const counter=page=>ui(page).locator('.ehtw-reader-page-count');
const imageRequests=(site,gid,page)=>site.state.log.filter(x=>new RegExp(`/h/${gid}-${page}/`).test(x.url)).length;

async function readerImageState(page,gid,pageNumber){
 return ui(page).locator('.ehtw-reader-page-image').evaluateAll((images,{gid,pageNumber})=>{
  const matches=images.filter(img=>{try{return new URL(img.dataset.pageUrl,location.href).pathname.endsWith(`${gid}-${pageNumber}`)}catch{return false}});
  const describe=image=>({pageUrl:image.dataset.pageUrl||'',failed:image.dataset.ehtwLoadFailed==='true',complete:image.complete,naturalWidth:image.naturalWidth,src:image.getAttribute('src')||'',currentSrc:image.currentSrc||'',memoryUnloaded:image.dataset.ehtwMemoryUnloaded==='true',memorySource:image.dataset.ehtwMemorySource||'',frameClass:image.closest('.ehtw-reader-image-frame')?.className||''});
  if(!matches.length)return{present:false,imageCount:0,images:[],failed:false,loading:false};
  const states=matches.map(describe),primaryIndex=Math.max(0,matches.findIndex(img=>img.classList.contains('ehtw-reader-active'))),primary=states[primaryIndex];
  return{...primary,present:true,imageCount:states.length,failed:states.some(state=>state.failed),loading:states.some(state=>String(state.frameClass).split(/\s+/).includes('ehtw-reader-image-loading')),images:states};
 },{gid,pageNumber});
}

async function waitForExhaustedFailure(page,site,gid,pageNumber,{testInfo,requestBaseline,requestRecordStart,label}){
 const stableWindowMs=Math.max(...THRESHOLDS.readerAutoRetryDelaysMs)+THRESHOLDS.readerAutoRetryStableMarginMs;
 const started=Date.now(),transitions=[];
 let lastSignature=null,lastRequestDelta=null,lastChangeAt=started,latest={settled:false};
 const requests=()=>dataFor(testInfo).requestRecords.slice(requestRecordStart).filter(record=>{
  if(record.type!=='image')return false;
  try{return new URL(record.url).pathname.startsWith(`/h/${gid}-${pageNumber}/`)}catch{return false}
 }).map(({at,url,type,readerTarget,readerPosition})=>({at,url,type,readerTarget,readerPosition}));
 const poll=async()=>{
  const now=Date.now(),state=await readerImageState(page,gid,pageNumber),requestDelta=imageRequests(site,gid,pageNumber)-requestBaseline,signature=JSON.stringify(state);
  if(signature!==lastSignature||requestDelta!==lastRequestDelta){lastSignature=signature;lastRequestDelta=requestDelta;lastChangeAt=now;transitions.push({afterMs:now-started,requestDelta,state,requests:requests()})}
  latest={settled:state.present&&state.failed&&!state.loading&&now-lastChangeAt>=stableWindowMs,stableWindowMs,requestDelta,state,transitions:[...transitions],requests:requests()};
  return latest;
 };
 try{await expect.poll(poll,{timeout:20_000,intervals:[100,150,250]}).toMatchObject({settled:true})}
 catch(error){error.message+=`\n${label}; automatic retry timestamps/state sequence=${JSON.stringify(latest)}`;throw error}
 return latest;
}

async function setPageSlider(page,number){
 const slider=ui(page).locator('.ehtw-reader-page-slider');
 await slider.evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));window.dispatchEvent(new Event('pointerup'))},number);
}
async function seekPage(page,number){await setPageSlider(page,number);await expect(counter(page)).toHaveText(`${number} / 45`,{timeout:15_000})}

async function pressImageAt(page,testInfo,fraction){
 const point=await page.evaluate(f=>{const img=document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('.ehtw-reader-image-frame')?.querySelector('img');if(!img)return null;const r=img.getBoundingClientRect(),x=r.left+r.width*f,y=Math.max(r.top+5,Math.min(innerHeight/2,r.bottom-5)),hit=document.elementFromPoint(x,y);return{x,y,pageUrl:img.dataset.pageUrl||'',failed:img.dataset.ehtwLoadFailed==='true',hit:hit?{tag:hit.tagName,id:hit.id,className:String(hit.className?.baseVal??hit.className??''),isImage:hit===img||img.contains(hit),insideFrame:!!hit.closest('.ehtw-reader-image-frame')}:null}},fraction);
 expect(point,'reader image should be under the viewport center').not.toBeNull();
 if(isTouch(testInfo))await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
 return point;
}

async function wheelOnePage(page,direction,target){
 const trace=[];
 const waitWheelFrames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 for(let i=0;i<160;i++){
  const before=Number((await counter(page).textContent()).split(' / ')[0]);
  if(before===target)return{target,trace};
  const frame=await page.evaluate(()=>{
   const imgs=[...document.querySelectorAll('.ehtw-reader-page-image')];if(!imgs.length)return null;
   const center=innerHeight/2,sorted=imgs.map(img=>{const r=img.getBoundingClientRect();return{height:r.height,distance:center<r.top?r.top-center:center>r.bottom?center-r.bottom:0,top:r.top,bottom:r.bottom,pageUrl:img.dataset.pageUrl||''}}).sort((a,b)=>a.distance-b.distance);
   return sorted[0];
  });
  if(!frame||!Number.isFinite(frame.height)||frame.height<=0)throw new Error(`wheel paging has no measurable reader frame; target=${target}; trace=${JSON.stringify(trace)}; frame=${JSON.stringify(frame)}`);
  const delta=Math.max(12,Math.min(80,Math.round(frame.height*.08)))*(direction==='forward'?1:-1);
  await page.mouse.wheel(0,delta);
  await waitWheelFrames();
  let after=Number((await counter(page).textContent()).split(' / ')[0]),input='wheel';
  // Chromium's emulated touch projects do not always deliver mouse-wheel input.
  // Fall back to a real document scroll, which still dispatches the reader's
  // scroll-driven page selection logic.
  if(after===before){await page.evaluate(delta=>window.scrollBy({top:delta,behavior:'instant'}),delta);await waitWheelFrames();after=Number((await counter(page).textContent()).split(' / ')[0]);input='scrollBy'}
  trace.push({before,after,delta,input,frameHeight:frame.height,frameTop:frame.top,frameBottom:frame.bottom,pageUrl:frame.pageUrl});
  if(direction==='forward'?after>target:after<target)throw new Error(`wheel paging overshot target ${target}; evidence=${JSON.stringify(trace)}`);
  if(after===target)return{target,trace};
 }
 throw new Error(`wheel paging did not reach target ${target}; evidence=${JSON.stringify(trace)}`);
}

async function moveOne(page,testInfo,mode,direction,target){
 if(mode==='keyboard'){await page.keyboard.press(direction==='forward'?'ArrowRight':'ArrowLeft');return null}
 if(mode==='wheel')return wheelOnePage(page,direction,target);
 return pressImageAt(page,testInfo,direction==='forward'?.85:.15);
}

for(const origin of origins)for(const mode of ['keyboard','wheel','click'])test(`D reader complete ${mode} round trips ${origin}`,async({page,site,diagnostics},testInfo)=>{
 const g=site.state.galleries[0],rounds=scale(1,5),lastPage=scale(11,45),onceKey=`${g.gid}-7`,failedKey=`${g.gid}-9`;
 const readerResponses=[];page.on('response',async response=>{try{const url=new URL(response.url());if(url.pathname.startsWith(`/h/${g.gid}-`))readerResponses.push({path:url.pathname,status:response.status()})}catch{}});
 const firstPage9RequestBaseline=imageRequests(site,g.gid,9),firstPage9RecordStart=dataFor(testInfo).requestRecords.length;
 dataFor(testInfo).readerPosition={gid:g.gid,page:1};dataFor(testInfo).readerTarget={gid:g.gid,page:1};site.state.failImages.add(failedKey);site.state.failOnceImages.add(onceKey);
 let stableImageCount=null;const readerImageDomCounts=[];
 await open(page,site.readerUrl(origin,g,1),{waitFor:'html.ehtw-reader'});
 await ui(page).locator('.ehtw-reader-root[data-ehtw-reader-ready="true"]').waitFor({state:'attached',timeout:15_000});
 if(mode==='keyboard'||mode==='click')await tap(page,testInfo,ui(page).locator('.ehtw-reader-mode').nth(1));
 for(let round=0;round<rounds;round++){
  let skipPage10=false;
  for(let number=2;number<=lastPage;number++){
   if(mode==='click'&&skipPage10&&number===10){expect(counter(page)).toHaveText('10 / 45');skipPage10=false;logOperation(testInfo,`${origin} click paging resumed after failure via slider at 10 / 45 round ${round+1}`,page.url());continue}
      const attemptsBeforeAction=number===9?imageRequests(site,g.gid,9):0,recordStartBeforeAction=number===9?dataFor(testInfo).requestRecords.length:0;
   dataFor(testInfo).readerPosition={gid:g.gid,page:Number((await counter(page).textContent()).split(' / ')[0])};dataFor(testInfo).readerTarget={gid:g.gid,page:number};
   const pointer=await moveOne(page,testInfo,mode,'forward',number);
   await expect(counter(page),`forward ${number}; click/wheel evidence=${JSON.stringify(pointer)}`).toHaveText(`${number} / 45`,{timeout:10_000});dataFor(testInfo).readerPosition={gid:g.gid,page:number};
   logOperation(testInfo,`${origin} ${mode} forward ${number} round ${round+1} evidence=${JSON.stringify(pointer)}`,page.url());
   await checkInvariants(page,diagnostics,site,'ehtw-reader');
   if(number===9){
    const failed=ui(page).locator('.ehtw-reader-image-frame.ehtw-reader-image-failed').first();
    await expect(failed,`failed page 9 in ${mode} mode`).toBeVisible({timeout:15_000});
    const baseline=round===0?firstPage9RequestBaseline:attemptsBeforeAction,recordStart=round===0?firstPage9RecordStart:recordStartBeforeAction;
    const exhausted=await waitForExhaustedFailure(page,site,g.gid,9,{testInfo,requestBaseline:baseline,requestRecordStart:recordStart,label:`${origin} ${mode} round ${round+1} automatic failure`});
    if(round===0)expect(imageRequests(site,g.gid,9),`cumulative page 9 requests from the fresh mock site (initial + two retries); evidence=${JSON.stringify({...exhausted,cumulativeRequests:imageRequests(site,g.gid,9)})}`).toBe(THRESHOLDS.readerAutoRetryExpectedAttempts);
    logOperation(testInfo,`${origin} ${mode} page 9 retry-settled evidence round ${round+1}: ${JSON.stringify(exhausted)}`,page.url());
    if(mode==='click'){
     const retryBaseline=imageRequests(site,g.gid,9),retryRecordStart=dataFor(testInfo).requestRecords.length,button=failed.locator('.ehtw-reader-retry-button');
     await expect(button).toBeVisible();await tap(page,testInfo,button);
     await expect.poll(()=>imageRequests(site,g.gid,9)-retryBaseline).toBeGreaterThan(0);
     const retry=await waitForExhaustedFailure(page,site,g.gid,9,{testInfo,requestBaseline:retryBaseline,requestRecordStart:retryRecordStart,label:`${origin} ${mode} in-loop manual retry`});
     expect(retry.requestDelta,`manual request + two automatic retries; evidence=${JSON.stringify(retry)}`).toBe(THRESHOLDS.readerAutoRetryExpectedAttempts);
     await expect(counter(page)).toHaveText('9 / 45');await seekPage(page,10);skipPage10=true;
     logOperation(testInfo,`${origin} click-mode retry icon stayed on page 9; slider advanced 9 → 10 round ${round+1}; evidence=${JSON.stringify(retry)}`,page.url());
    }
   }
   if(number===7){
    const page7=()=>ui(page).locator('.ehtw-reader-page-image').evaluateAll((imgs,gid)=>{const img=imgs.find(x=>{try{return new URL(x.dataset.pageUrl,location.href).pathname.endsWith(`${gid}-7`)}catch{return false}});if(!img)return{present:false};const r=img.getBoundingClientRect();return{present:true,loaded:img.complete&&img.naturalWidth>0,failed:img.dataset.ehtwLoadFailed==='true',src:img.currentSrc||img.src||'',memorySource:img.dataset.ehtwMemorySource||'',inViewport:r.bottom>0&&r.top<innerHeight}},g.gid);
    await expect.poll(page7,{timeout:15_000}).toMatchObject({present:true,loaded:true,failed:false,inViewport:true});
    const page7Trace=dataFor(testInfo).requestRecords.filter(record=>record.type==='image'&&new URL(record.url).pathname.startsWith(`/h/${g.gid}-7/`)).map(({at,url,readerTarget,readerPosition})=>({at,url,readerTarget,readerPosition}));if(round===0){/* S8 owns duplicate-download coverage; this checks failOnce's single 503, a successful 200, and final image state. */testInfo.annotations.push({type:'D-page-7-request-timeline',description:JSON.stringify(page7Trace)});const page7Responses=readerResponses.filter(item=>item.path.startsWith(`/h/${g.gid}-7/`));expect(page7Responses.filter(item=>item.status===503),`page 7 injected failure response count; responses=${JSON.stringify(page7Responses)}`).toHaveLength(1);expect(page7Responses.filter(item=>item.status===200),`page 7 successful response count; responses=${JSON.stringify(page7Responses)}`).not.toHaveLength(0);expect(await page7(),`page 7 ends loaded and not failed; responses=${JSON.stringify(page7Responses)}`).toMatchObject({loaded:true,failed:false})}
   }
  }
  for(let number=lastPage-1;number>=1;number--){
   if(mode==='click'&&number===8&&Number((await counter(page).textContent()).split(' / ')[0])===9){dataFor(testInfo).readerTarget={gid:g.gid,page:8};await page.keyboard.press('ArrowLeft');await expect(counter(page),`keyboard escape from failed page 9 during click-mode backward pass`).toHaveText('8 / 45',{timeout:10_000});logOperation(testInfo,`${origin} click-mode keyboard bypass failed page 9 → 8 round ${round+1}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-reader');continue}
   dataFor(testInfo).readerPosition={gid:g.gid,page:Number((await counter(page).textContent()).split(' / ')[0])};dataFor(testInfo).readerTarget={gid:g.gid,page:number};const pointer=await moveOne(page,testInfo,mode,'backward',number);
   await expect(counter(page),`backward ${number}; click/wheel evidence=${JSON.stringify(pointer)}`).toHaveText(`${number} / 45`,{timeout:10_000});dataFor(testInfo).readerPosition={gid:g.gid,page:number};
   logOperation(testInfo,`${origin} ${mode} backward ${number} round ${round+1} evidence=${JSON.stringify(pointer)}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-reader');
  }
  const domImages=await ui(page).locator('.ehtw-reader-root img').count();readerImageDomCounts.push(domImages);expect(domImages).toBeLessThanOrEqual(THRESHOLDS.readerImages.maxNodes);if(stableImageCount===null)stableImageCount=domImages;else expect(domImages,`reader image DOM count round ${round+1}`).toBe(stableImageCount);
 }
 testInfo.annotations.push({type:'D-reader-image-dom-observation',description:JSON.stringify({origin,mode,counts:readerImageDomCounts,max:Math.max(...readerImageDomCounts)})});
 dataFor(testInfo).readerTarget={gid:g.gid,page:9};
 const beforeSeek=await readerImageState(page,g.gid,9),attemptsBeforeSeek=imageRequests(site,g.gid,9),seekRecordStart=dataFor(testInfo).requestRecords.length;
 await seekPage(page,9);
 const settledEvidence=await waitForExhaustedFailure(page,site,g.gid,9,{testInfo,requestBaseline:attemptsBeforeSeek,requestRecordStart:seekRecordStart,label:`${origin} ${mode} final failed-page seek evidence`});
 logOperation(testInfo,`${origin} ${mode} return to failed page 9; evidence=${JSON.stringify({before:beforeSeek,after:settledEvidence.state,requestDelta:settledEvidence.requestDelta,retryTrace:settledEvidence})}`,page.url());
 const failed=ui(page).locator('.ehtw-reader-image-frame.ehtw-reader-image-failed').first();
 const retryBaseline=imageRequests(site,g.gid,9),retryRecordStart=dataFor(testInfo).requestRecords.length,retryButton=failed.locator('.ehtw-reader-retry-button');
 await expect(retryButton,`visible retry control for failed page 9`).toBeVisible();await tap(page,testInfo,retryButton);
 await expect.poll(()=>imageRequests(site,g.gid,9)-retryBaseline,{message:'clicking the failed page should retry its image request'}).toBeGreaterThan(0);
 const finalRetry=await waitForExhaustedFailure(page,site,g.gid,9,{testInfo,requestBaseline:retryBaseline,requestRecordStart:retryRecordStart,label:`${origin} ${mode} final manual retry`});
 expect(finalRetry.requestDelta,`manual request + two automatic retries; evidence=${JSON.stringify(finalRetry)}`).toBe(THRESHOLDS.readerAutoRetryExpectedAttempts);await expect(counter(page)).toHaveText('9 / 45');
 dataFor(testInfo).readerPosition={gid:g.gid,page:9};dataFor(testInfo).readerTarget={gid:g.gid,page:8};
 if(mode==='keyboard'){await page.keyboard.press('ArrowLeft');await expect(counter(page),`keyboard must leave failed page 9`).toHaveText('8 / 45',{timeout:10_000})}else await seekPage(page,8);
 dataFor(testInfo).readerPosition={gid:g.gid,page:8};dataFor(testInfo).readerTarget={gid:g.gid,page:9};await seekPage(page,9);await expect(failed).toBeVisible({timeout:15_000});
 dataFor(testInfo).readerPosition={gid:g.gid,page:9};dataFor(testInfo).readerTarget={gid:g.gid,page:8};await seekPage(page,8);await expect(counter(page),`page slider must leave failed page 9 in ${mode} mode`).toHaveText('8 / 45');
 const samples=await snapshot(page),network=dataFor(testInfo).readerImageNetwork;testInfo.annotations.push({type:'reader-image-network',description:`all /h/ peak=${network.peak} urls=${JSON.stringify(network.peakUrls)}; non-current candidate preload peak=${network.preloadPeak} urls=${JSON.stringify(network.preloadPeakUrls)}; peak targets/positions=${JSON.stringify(network.preloadPeakDetails)}`});expect(network.preloadPeak,`reader non-current image inflight peak; candidate preload URLs=${JSON.stringify(network.preloadPeakUrls)}; targets/positions=${JSON.stringify(network.preloadPeakDetails)}`).toBeLessThanOrEqual(5);expect(samples.network.readerImages.preloadPeak).toBe(network.preloadPeak);expect(diagnostics.pageErrors).toEqual([]);await settle(page);logOperation(testInfo,`${origin} ${mode} failure retry and keyboard/slider escape`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-reader');
});

for(const origin of origins)test(`S6 returning to an exhausted failed page retries automatically ${origin}`,async({page,site,diagnostics},testInfo)=>{
  const g=site.state.galleries[0];site.state.failImages.add(`${g.gid}-9`);dataFor(testInfo).readerPosition={gid:g.gid,page:9};dataFor(testInfo).readerTarget={gid:g.gid,page:9};
  const attemptsBeforeOpen=imageRequests(site,g.gid,9),requestRecordStart=dataFor(testInfo).requestRecords.length;
  await open(page,site.readerUrl(origin,g,9),{waitFor:'html.ehtw-reader'});await ui(page).locator('.ehtw-reader-root[data-ehtw-reader-ready="true"]').waitFor({state:'attached',timeout:15_000});
  const exhausted=await waitForExhaustedFailure(page,site,g.gid,9,{testInfo,requestBaseline:attemptsBeforeOpen,requestRecordStart,label:`${origin} S6 initial failed page`});
  expect(imageRequests(site,g.gid,9),`initial request plus two automatic retries; evidence=${JSON.stringify(exhausted)}`).toBe(3);
  const cumulativeRequests=imageRequests(site,g.gid,9);const beforeLeave=await readerImageState(page,g.gid,9);expect(beforeLeave,`page 9 must still be resident and failed before leaving: ${JSON.stringify(beforeLeave)}`).toMatchObject({present:true,failed:true});
  logOperation(testInfo,`${origin} S6 exhausted page 9 before leaving; cumulativeRequests=${cumulativeRequests}; evidence=${JSON.stringify(exhausted)}; DOM=${JSON.stringify(beforeLeave)}`,page.url());
  dataFor(testInfo).readerTarget={gid:g.gid,page:5};await seekPage(page,5);logOperation(testInfo,`${origin} S6 left failed page 9 for page 5`,page.url());
  const requestsBeforeReturn=imageRequests(site,g.gid,9);dataFor(testInfo).readerTarget={gid:g.gid,page:9};await setPageSlider(page,9);
  await expect.poll(async()=>({returned:(await counter(page).textContent()||'').trim()==='9 / 45',requestDelta:imageRequests(site,g.gid,9)-requestsBeforeReturn}),{timeout:10_000,message:'returning to page 9 should start a fresh request within 10 seconds'}).toMatchObject({returned:true,requestDelta:expect.any(Number)});
  const afterReturn=await readerImageState(page,g.gid,9);expect(imageRequests(site,g.gid,9)-requestsBeforeReturn,`return should request page 9; state=${JSON.stringify(afterReturn)}`).toBeGreaterThan(0);logOperation(testInfo,`${origin} S6 return request delta=${imageRequests(site,g.gid,9)-requestsBeforeReturn}; DOM=${JSON.stringify(afterReturn)}`,page.url());await checkInvariants(page,diagnostics,site,'ehtw-reader');
});

const S7_COMPLETE_RACE_SCRIPT=`(()=>{
 const original=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'complete'),seen=new WeakSet();
 if(!original?.get)return;
 Object.defineProperty(HTMLImageElement.prototype,'complete',{configurable:original.configurable,enumerable:original.enumerable,get(){let matches=false;try{matches=/\\/h\\/\\d+-9\\//.test(new URL(this.currentSrc||this.getAttribute('src')||'',location.href).pathname)}catch{}return matches&&!seen.has(this)?true:original.get.call(this)}});
 document.addEventListener('error',event=>{const image=event.target;if(!(image instanceof HTMLImageElement))return;try{if(/\\/h\\/\\d+-9\\//.test(new URL(image.currentSrc||image.getAttribute('src')||'',location.href).pathname))seen.add(image)}catch{}},true);
})();`;
test.describe('S7 deterministic image error race',()=>{
 test.use({preInitScript:`${PROBE_SCRIPT}\n${S7_COMPLETE_RACE_SCRIPT}`});
 for(const origin of [EH,EX])test(`S7 one load failure consumes one automatic retry ${origin}`,async({page,site,diagnostics},testInfo)=>{
   const g=site.state.galleries[0];site.state.failImages.add(`${g.gid}-9`);dataFor(testInfo).readerPosition={gid:g.gid,page:9};dataFor(testInfo).readerTarget={gid:g.gid,page:9};
   const start=dataFor(testInfo).requestRecords.length;await open(page,site.readerUrl(origin,g,9),{waitFor:'html.ehtw-reader'});await ui(page).locator('.ehtw-reader-root[data-ehtw-reader-ready="true"]').waitFor({state:'attached',timeout:15_000});
   const evidence=await waitForExhaustedFailure(page,site,g.gid,9,{testInfo,requestBaseline:0,requestRecordStart:start,label:`${origin} S7 deterministic complete-before-error race`}),actualRequests=imageRequests(site,g.gid,9);
   logOperation(testInfo,`${origin} S7 failed page 9 settled after ${actualRequests} cumulative request(s); evidence=${JSON.stringify(evidence)}`,page.url());
   expect(actualRequests,`simulated load/error race must use initial request plus two automatic retries; evidence=${JSON.stringify(evidence)}`).toBe(3);expect(evidence.state).toMatchObject({present:true,failed:true,loading:false});await checkInvariants(page,diagnostics,site,'ehtw-reader');
 });
});

for(const mode of ['scroll','keyboard'])test(`S8 preloaded images are not downloaded twice ${mode} ${EH}`,async({page,site,diagnostics},testInfo)=>{
  const g=site.state.galleries[0],lastPage=scale(12,20),counts=Array(45).fill(0),pending=new Set();let lastActivity=Date.now();
  const imagePage=url=>{try{const match=new URL(url).pathname.match(new RegExp(`/h/${g.gid}-(\\d+)/`));return match?Number(match[1]):null}catch{return null}};
  page.on('request',request=>{const n=imagePage(request.url());if(n!==null){pending.add(request);lastActivity=Date.now()}});
  page.on('requestfinished',request=>{if(pending.delete(request))lastActivity=Date.now()});page.on('requestfailed',request=>{if(pending.delete(request))lastActivity=Date.now()});
  page.on('response',response=>{const n=imagePage(response.url());if(n!==null&&response.status()===200)counts[n-1]++});
  dataFor(testInfo).readerPosition={gid:g.gid,page:1};dataFor(testInfo).readerTarget={gid:g.gid,page:1};await open(page,site.readerUrl(EH,g,1),{waitFor:'html.ehtw-reader'});await ui(page).locator('.ehtw-reader-root[data-ehtw-reader-ready="true"]').waitFor({state:'attached',timeout:15_000});
  if(mode==='keyboard')await tap(page,testInfo,ui(page).locator('.ehtw-reader-mode').nth(1));
  for(let n=2;n<=lastPage;n++){dataFor(testInfo).readerPosition={gid:g.gid,page:n-1};dataFor(testInfo).readerTarget={gid:g.gid,page:n};if(mode==='keyboard'){await page.keyboard.press('ArrowRight')}else{const movement=await wheelOnePage(page,'forward',n);testInfo.annotations.push({type:'S8-scroll-step',description:JSON.stringify(movement)})}await expect(counter(page),`${mode} navigation to page ${n}`).toHaveText(`${n} / 45`,{timeout:15_000});logOperation(testInfo,`${EH} S8 ${mode} reached page ${n}`,page.url())}
  await expect.poll(()=>pending.size===0&&Date.now()-lastActivity>=2000,{timeout:30_000,intervals:[100,200,400,800],message:'all reader image responses become quiet before per-page counting'}).toBe(true);
  const duplicates=counts.map((count,index)=>({page:index+1,count})).filter(item=>item.count>1),evidence={mode,counts,duplicates};testInfo.annotations.push({type:'S8-page-200-responses',description:JSON.stringify(evidence)});
  expect(duplicates,`${mode} mode page HTTP 200 response counts; per-page counts=${JSON.stringify(counts)}`).toEqual([]);
  await checkInvariants(page,diagnostics,site,'ehtw-reader');
});
