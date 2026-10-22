/* Full pages and real render/log scripts. GPS is simulated; one regression delays real fullscreen exit. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const {root}=require('./helpers.cjs');
async function assertDeviceCleanup(page){
 assert.equal(await page.evaluate(()=>rideDeviceReliabilityActive),false,'Session must disarm device reliability');
 // The summary is synchronous, but the browser's exitFullscreen() promise is not.
 // Wait on the resulting state, without weakening the assertion or adding a sleep.
 await page.waitForFunction(()=>!document.fullscreenElement,null,{timeout:5000});
 assert.equal(await page.evaluate(()=>!!document.fullscreenElement),false,'Fullscreen must exit after session completion');
}
let activeScenario='server startup';
(async()=>{
 const server=spawn('python3',['tools/serve.py','--port','0'],{cwd:root,stdio:['ignore','pipe','pipe']});
 let browser;
 try{
 const line=await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('Server exited')}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Server startup timeout')),10000);t.unref()})]);
 const port=String(line[0]).match(/port (\d+)/)[1];
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true});
 console.log(`Browser workflows: Node ${process.version}, Chromium ${browser.version()}`);
 for(const {mobile,exitDelay} of [{mobile:false,exitDelay:0},{mobile:true,exitDelay:0},{mobile:false,exitDelay:2000}]){
 const mode=exitDelay?'desktop (delayed fullscreen exit)':mobile?'mobile':'desktop';
 activeScenario=mode;
 console.log(`START ${mode}`);
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1200,height:900},isMobile:mobile,hasTouch:mobile,acceptDownloads:true});
 if(exitDelay)await context.addInitScript(delay=>{
   const exit=document.exitFullscreen?.bind(document);
   window.fullscreenExitRequests=0;
   if(exit)document.exitFullscreen=()=>{
     window.fullscreenExitRequests+=1;
     return new Promise((resolve,reject)=>setTimeout(()=>exit().then(resolve,reject),delay));
   };
 },exitDelay);
 await context.addInitScript(()=>{
   let id=0,fix={latitude:0,longitude:0,accuracy:3,speed:4};const watches=new Map();
   const position=()=>({timestamp:Date.now(),coords:{...fix}});
   navigator.geolocation.watchPosition=(ok,error)=>{const key=++id;watches.set(key,{ok,error});queueMicrotask(()=>{if(watches.has(key))ok(position())});return key};
   navigator.geolocation.clearWatch=key=>watches.delete(key);
   navigator.geolocation.getCurrentPosition=ok=>queueMicrotask(()=>ok(position()));
   window.emitGps=(x,y=0,accuracy=3,speed=4)=>{fix={latitude:y/111320,longitude:x/111320,accuracy,speed};for(const w of [...watches.values()])w.ok(position())};
 });
 const page=await context.newPage();const errors=[],failed=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))failed.push(r.url())});
 await page.clock.install();
 await page.goto(`http://127.0.0.1:${port}/`);assert.equal(await page.title(),'Augmentum');
 await page.getByRole('link',{name:/Record route/}).click();
 await page.waitForFunction(()=>document.querySelector('#accNum').textContent==='3');
 for(const x of [0,100]){
   await page.evaluate(x=>window.emitGps(x),x);await page.locator('#dropBtn').click();
   await page.locator('#formBox').waitFor({state:'visible'});
   await page.locator('#landInput').fill('<img src=x onerror="throw Error(1)">');
   if(x===100)await page.locator('#cueSelect').selectOption('arrive');
   await page.getByRole('button',{name:'Save waypoint',exact:true}).click();
 }
 assert.equal(await page.locator('#wpList .wp').count(),2);assert.equal(await page.locator('#wpList img').count(),0);
 page.on('dialog',d=>d.type()==='prompt'?d.accept('simulated-route'):d.accept());
 let download=page.waitForEvent('download');await page.locator('#finishBtn').click();
 const exported=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));assert.equal(exported.length,2);
 await page.goto(`http://127.0.0.1:${port}/test-engine.html`);
 await page.waitForFunction(()=>!document.querySelector('#startBtn').disabled);
 // Re-import the exported route through the actual mobile file input.
 await page.locator('#routeImport').setInputFiles({name:'route.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
 await page.locator('#sessionLabelInput').fill('browser-session');await page.locator('#startBtn').click();
 const gps=async(x,y=0,accuracy=3,speed=4)=>{await page.clock.runFor(1000);await page.evaluate(({x,y,accuracy,speed})=>window.emitGps(x,y,accuracy,speed),{x,y,accuracy,speed})};
 await gps(0,0,3,0);await gps(0,0,3,0);await gps(0,0,3,0);
 assert.equal(await page.evaluate(()=>state.context),'stationary');
 for(const x of [20,40,60,80,98,100])await gps(x);
 await page.clock.runFor(1300);
 await page.locator('#summaryPanel').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>state.finished),true);
 assert.equal(await page.locator('#sumWaypoints').textContent(),'1');
 await assertDeviceCleanup(page);
 assert.equal(await page.locator('#scr img').count(),0);
 download=page.waitForEvent('download');await page.getByRole('button',{name:'Download log',exact:true}).click();
 const records=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));
 for(const event of ['session_started','route_started','stationary_entered','stationary_exited','waypoint_reached','route_completed','session_ended'])assert.ok(records.some(r=>r.event_type===event),event);
 await page.clock.runFor(5001);assert.equal(await page.locator('#startBtn').isDisabled(),true);
 // The same UI imports full geometry and completes a turn using outgoing evidence.
 const geometryRoute={schemaVersion:2,id:'browser-polyline',geometry:[[0,0],[50/111320,0],[100/111320,0],[100/111320,50/111320],[100/111320,100/111320]],
   maneuvers:[{geometryIndex:2,cue:'turn',rot:90},{geometryIndex:4,cue:'arrive'}]};
 await page.locator('#routeImport').setInputFiles({name:'polyline.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(geometryRoute))});
 await page.evaluate(()=>window.emitGps(0));
 await page.locator('#sessionLabelInput').fill('geometry-browser-session');await page.locator('#startBtn').click();
 for(const x of [0,20,40,60,80,100])await gps(x);
 assert.equal(await page.evaluate(()=>state.legIndex),0);assert.equal(await page.evaluate(()=>state.confirmHold),false);
 await gps(100,20);await page.clock.runFor(1300);assert.equal(await page.evaluate(()=>state.legIndex),1);
 for(const y of [40,60,80,98])await gps(100,y);
 await gps(100,100,3,0);await page.clock.runFor(1300);
 assert.equal(await page.evaluate(()=>state.finished),true);assert.equal(await page.locator('#sumWaypoints').textContent(),'2');
 await assertDeviceCleanup(page);
 if(exitDelay && !await page.evaluate(()=>window.fullscreenExitRequests))console.log('NOTE: Fullscreen unavailable; delayed-exit path was not exercised in this browser');
 assert.ok(await page.evaluate(()=>TOTAL_ROUTE_DIST>199 && TOTAL_ROUTE_DIST<201));
 assert.ok(await page.evaluate(()=>getLogRecords().some(r=>r.event_type==='route_completed' && r.routeId==='browser-polyline' && r.progressMeters>199)));
 console.log(`PASS ${mode} geometry: polyline import, along-route distances, outgoing turn evidence, ordered completion and research metadata`);
 if(mobile)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile overflow');
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 console.log(`PASS ${mode}: record/export/import, escaped landmarks, stationary/motion, completion, device cleanup, log export, GPS expiry`);
 await context.close();
 }
 } finally {if(browser)await browser.close();server.kill();await once(server,'exit').catch(()=>{})}
})().catch(e=>{console.error(`Browser workflow failed during ${activeScenario}:`,e);process.exitCode=1});
