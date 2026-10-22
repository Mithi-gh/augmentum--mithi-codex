const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./helpers.cjs');

test('preflight can start without optional wake lock, expires and resets on every GPS error',()=>{
 const f=fixture({preflight:true});f.run('startPreflightChecks(()=>{})');
 const watch=[...f.watches.values()][0];
 const pos={timestamp:f.now(),coords:{latitude:0,longitude:0,accuracy:5}};watch.ok(pos);
 assert.equal(f.run('preflightAllGreen()'),true);
 for(const code of [1,2,3]){watch.ok({...pos,timestamp:f.now()});watch.error({code});assert.equal(f.run('preflightAllGreen()'),false)}
 watch.ok({...pos,timestamp:f.now()});f.advance(5000);assert.equal(f.run('preflightAllGreen()'),false);
 f.run('startPreflightChecks(()=>{})');assert.equal(f.watches.size,1);
 watch.ok({...pos,timestamp:f.now()});assert.equal(f.run('preflightAllGreen()'),false);
});
test('repeated session labels preserve previous logs and completed duration remains stable',()=>{
 const f=fixture();f.run("startSession('same')");f.advance(1000);f.run("endSession('ended')");
 assert.equal(f.run('buildSessionSummary().durationMs'),1000);f.advance(10000);assert.equal(f.run('buildSessionSummary().durationMs'),1000);
 const first=f.storage.get('augmentumLog:same');f.run("startSession('same')");assert.equal(f.run('sessionLabel'),'same (2)');assert.equal(f.storage.get('augmentumLog:same'),first);
});
test('quota failure preserves exportable records in memory and exposes persistence error',()=>{
 const f=fixture({storageFails:true});f.run("startSession('test');logEvent('action_card_tapped','')");
 assert.equal(f.events().length,2);assert.match(f.run('logPersistenceError'),/Quota/);
});
test('late wake lock promises are released after session end',async()=>{
 const f=fixture({preflight:true});let resolve,released=0;
 f.context.navigator.wakeLock={request:()=>new Promise(r=>resolve=r)};
 f.run('rideDeviceReliabilityActive=true;requestWakeLock();disarmDeviceReliability()');
 resolve({release:async()=>{released++},addEventListener(){}});await new Promise(setImmediate);
 assert.equal(released,1);assert.equal(f.run('wakeLock'),null);assert.equal(f.run('deviceStatus.wakeLock'),false);
});
test('route landmarks are escaped before interpolation into stationary cards',()=>{
 const f=fixture();f.start();f.run("ROUTE[1].land='<img src=x onerror=alert(1)>'; state.context='stationary';state.actionInverted=true;render()");
 assert.ok(!f.elements.get('scr').innerHTML.includes('<img'));
 assert.ok(f.elements.get('scr').innerHTML.includes('&lt;img'));
});
