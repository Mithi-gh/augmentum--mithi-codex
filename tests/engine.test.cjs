const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./helpers.cjs');
const events=(f,type)=>f.events().filter(e=>e.event_type===type);

test('route validation rejects malformed data and recomputes distances without mutating input',()=>{
 const f=fixture(); f.start(); assert.ok(f.run('TOTAL_ROUTE_DIST')<201);assert.equal(f.context.input[1].distFromPrevious,99999);
 for(const input of [[],[{}],[{},{}],f.route([[0,0,'continue'],[0,0,'arrive']]),f.route([[0,0,'continue'],[100,0,'bogus']])]){
  f.context.bad=input;assert.throws(()=>f.run('startTest(bad)'));assert.equal(f.watches.size,1);
 }
 f.context.bad=f.route();f.context.bad[1].lat=NaN;assert.throws(()=>f.run('startTest(bad)'));
});
test('final arrival requires start acquisition and two nearby reliable fixes; stopped arrival completes once',()=>{
 const f=fixture();f.start([[0,0,'continue'],[100,0,'arrive']]);
 f.fix(100);f.fix(100);assert.equal(f.state().finished,false);
 f.fix(0,0,{ms:6000});f.fix(25);f.fix(50);f.fix(75);f.fix(98);
 f.fix(100,0,{speed:0}); assert.equal(f.state().confirmHold,true);
 f.advance(1200);assert.equal(f.state().finished,true);assert.equal(f.watches.size,0);
 f.fix(100);assert.equal(events(f,'waypoint_reached').length,1);assert.equal(events(f,'route_completed').length,1);
 assert.equal(f.run('routeFillPct()'),100);assert.doesNotThrow(()=>f.run("state.context='stationary';render()"));
});
test('sampling across a continue waypoint progresses without hitting its exact coordinate',()=>{
 const f=fixture();f.start([[0,0,'continue'],[100,0,'continue'],[200,0,'arrive']]);
 for(const x of [0,25,50,75,115])f.fix(x,0,{ms:2000});
 assert.equal(f.state().legIndex,1);assert.equal(events(f,'waypoint_reached').length,1);
});
test('crossing a turn without following its outgoing leg does not silently advance',()=>{
 const f=fixture();f.start([[0,0,'continue'],[100,0,'turn'],[100,100,'arrive']]);
 for(const x of [0,25,50,75,115,140,150,160])f.fix(x,0,{ms:2000});
 assert.equal(f.state().legIndex,0);assert.equal(f.state().offRouteActive,true);
 assert.equal(events(f,'waypoint_reached').length,0);
 f.advance(10000);assert.equal(f.state().recoveryGlyph,'offroute');
});
test('sparse samples following an outgoing turn can advance after confirmation',()=>{
 const f=fixture();f.start([[0,0,'continue'],[100,0,'turn'],[100,100,'arrive']]);
 for(const x of [0,25,50,75,95])f.fix(x);
 f.fix(100,12);assert.equal(f.state().confirmHold,true);f.advance(1200);
 assert.equal(f.state().legIndex,1);assert.equal(events(f,'waypoint_reached').length,1);
});
test('poor GPS, explicit errors and stop cancel confirmation; signal silence expires after 5s',()=>{
 for(const mode of ['poor','silence','error','stop']){
 const f=fixture();f.start([[0,0,'continue'],[100,0,'arrive']]);
 for(const x of [0,25,50,75,98,100])f.fix(x);
 assert.equal(f.state().confirmHold,true);
 if(mode==='poor')f.fix(100,0,{accuracy:80,ms:100});
 if(mode==='error')f.run("onFixError({code:2,message:'unavailable'})");
 if(mode==='stop')f.run('stopTest()');
 if(mode==='silence')f.advance(5001);else f.advance(1200);
 // A silent 1.2s confirmation is allowed only while the most recent fix is fresh.
 if(mode!=='silence')assert.equal(f.state().finished,false);
 }
 const f=fixture();f.start();f.fix(0);for(let i=0;i<5;i++)f.fix(10,0,{accuracy:80,ms:100});
 assert.equal(f.state().gpsWeak,true);assert.equal(events(f,'gps_weak_flagged').length,1);
 f.fix(5);assert.equal(f.state().gpsWeak,false);assert.equal(events(f,'gps_recovered').length,1);
 f.advance(5000);assert.equal(f.state().gpsWeak,true);
});
test('confirmation is cancelled on moving away and completion is not logged twice',()=>{
 const f=fixture();f.start([[0,0,'continue'],[100,0,'arrive']]);
 for(const x of [0,25,50,75,98,100])f.fix(x);
 f.fix(115,0,{ms:100});f.advance(1200);assert.equal(f.state().finished,false);assert.equal(events(f,'waypoint_reached').length,0);
});
test('stationary and motion transitions need continuous evidence and log current coordinates',()=>{
 const f=fixture();f.start();f.fix(0);for(let i=0;i<3;i++)f.fix(0,0,{speed:0});
 assert.equal(f.state().context,'stationary');assert.equal(events(f,'stationary_entered').length,1);
 f.fix(5);f.fix(10);assert.equal(f.state().context,'motion');
 assert.equal(events(f,'stationary_exited')[0].lng,10/111320);
 f.fix(10,0,{ms:10000,speed:0});assert.equal(f.state().context,'motion');
 f.fix(10,0,{speed:0});f.fix(10,0,{accuracy:90,speed:0});f.fix(10,0,{speed:0});assert.equal(f.state().context,'motion');
});
test('invalid, old, future, duplicate fixes and implausible jumps cannot corrupt progress',()=>{
 const f=fixture();f.start();f.fix(0);const old=f.state().lastFix;
 for(const options of [{latitude:NaN},{accuracy:NaN},{accuracy:-1},{timestamp:old.t},{timestamp:old.t-10000},{timestamp:9999999}]) f.fix(1,0,options);
 assert.deepEqual(f.state().lastFix,old);
 f.fix(10000);assert.equal(f.state().lastFix.lng,0);assert.equal(f.state().gpsWeak,true);
});
test('off-route detection and recovery use separate thresholds and consecutive good fixes',()=>{
 const f=fixture();f.start();f.fix(0);
 for(const x of [20,40,60])f.fix(x,35,{ms:2000});assert.equal(f.state().offRouteActive,true);
 assert.equal(events(f,'off_route_entered')[0].lat,35/111320);
 f.fix(60,14);f.fix(65,18);f.fix(70,14);f.fix(75,14);assert.equal(f.state().offRouteActive,true);
 f.fix(80,14);assert.equal(f.state().offRouteActive,false);assert.equal(events(f,'off_route_cleared').length,1);
});
test('callbacks queued by an old watch are ignored after stop and restart',()=>{
 const f=fixture();f.start();const old=[...f.watches.values()][0];f.fix(0);f.run('stopTest()');
 old.ok({coords:{latitude:0,longitude:.001,accuracy:2},timestamp:f.now()});assert.equal(f.state().lastFix.lng,0);
 f.start();old.error({code:1,message:'denied'});assert.equal(f.state().gpsWeak,false);
});
test('fallback speed handles unavailable and invalid device speeds; negative progress is clamped',()=>{
 const f=fixture();f.start();f.fix(0,0,{speed:null});for(let i=0;i<3;i++)f.fix(1,0,{speed:-1});
 assert.equal(f.state().context,'stationary');
 f.run('state.trueDist=100000');assert.equal(f.run('routeFillPct()'),0);
 assert.equal(f.run("maneuverCopy('turn','act',90)[1]"),'Turn right');
});
test('moving along the outgoing leg preserves turn confirmation; continuing straight cancels it',()=>{
 for(const followTurn of [true,false]){
 const f=fixture();f.start([[0,0,'continue'],[100,0,'turn'],[100,100,'arrive']]);
 for(const x of [0,25,50,75,95,100])f.fix(x);
 assert.equal(f.state().confirmHold,true);
 f.fix(followTurn?100:115,followTurn?15:0,{ms:1000});f.advance(300);
 assert.equal(f.state().legIndex,followTurn?1:0);
 }
});
test('cached fixes and perfect accuracy do not turn signal loss or a single fix into arrival',()=>{
 const f=fixture();f.start([[0,0,'continue'],[100,0,'arrive']]);f.fix(0);
 for(const x of [25,50,75,100])f.fix(x,0,{accuracy:0});
 assert.equal(f.state().finished,false);f.advance(5001);assert.equal(f.state().gpsWeak,true);assert.equal(f.state().finished,false);
});
test('a loop returning to the start cannot skip intermediate waypoints',()=>{
 const f=fixture();f.start([[0,0,'continue'],[100,0,'turn'],[100,100,'turn'],[0,0,'arrive']]);
 f.fix(0);f.fix(0);f.advance(1500);assert.equal(f.state().finished,false);assert.equal(f.state().legIndex,0);
});
test('short first legs cannot complete from repeated stationary fixes at the start',()=>{
 const f=fixture();f.start([[0,0,'continue'],[5,0,'arrive']]);
 for(let i=0;i<10;i++)f.fix(0,0,{speed:0});
 assert.equal(f.state().finished,false);assert.equal(events(f,'waypoint_reached').length,0);
});
