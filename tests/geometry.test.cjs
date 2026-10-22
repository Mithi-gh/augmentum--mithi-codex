const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {root,fixture}=require('./helpers.cjs');
const path=require('node:path');
const coordinate=([x,y])=>[x/111320,y/111320];
function document(points,maneuvers){
 return {schemaVersion:2,id:'gps-fixture',geometry:points.map(coordinate),maneuvers:maneuvers??[{geometryIndex:points.length-1,cue:'arrive'}]};
}
function matching(points,maneuvers){
 const context=vm.createContext({});const run=s=>vm.runInContext(s,context);
 for(const file of ['route.js','geometry.js','map-matcher.js'])run(fs.readFileSync(path.join(root,file),'utf8'));
 context.route=document(points,maneuvers);run('const model=RouteGeometry.compile(route);const matcher=new RouteMatcher(model)');
 let time=0;
 const update=(x,y=0,{accuracy=5,speed=5,heading=null,ms=1000}={})=>{
  time+=ms;context.fix={lat:y/111320,lng:x/111320,t:time,accuracy,speed,heading};
  return JSON.parse(run('JSON.stringify(matcher.update(fix))'));
 };
 return {run,update,context};
}
function engine(points,maneuvers){const f=fixture();f.context.input=document(points,maneuvers);f.run("startSession('geometry');startTest(input)");return f;}
const close=(actual,expected,tolerance=1)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} ≈ ${expected}`);

test('geometry modules compile without UI globals, preserve curves and ignore supplied distances',()=>{
 const f=matching([[0,0],[100,0],[100,100],[200,100]]);
 close(f.run('model.length'),300);assert.equal(f.run('model.segments.length'),3);
 close(f.run('model.maneuvers[0].dist'),300);assert.equal(f.run('model.legacy'),false);
});
test('versioned schema rejects invalid indices, duplicates, early arrival and invalid coordinates',()=>{
 const f=matching([[0,0],[100,0]]);
 for(const change of [r=>r.geometry[1]=[Infinity,0],r=>r.geometry[1]=r.geometry[0],r=>r.maneuvers[0].geometryIndex=0,r=>r.maneuvers[0].geometryIndex=2,r=>r.maneuvers[0].cue='invented',r=>r.schemaVersion=3]){
  const route=document([[0,0],[100,0]]);change(route);f.context.bad=route;assert.throws(()=>f.run('RouteGeometry.compile(bad)'));
 }
 f.context.bad=document([[0,0],[50,0],[100,0]],[{geometryIndex:1,cue:'arrive'},{geometryIndex:2,cue:'arrive'}]);assert.throws(()=>f.run('RouteGeometry.compile(bad)'));
});
test('projection and cumulative lengths handle longitude wrapping',()=>{
 const f=matching([[0,0],[100,0]]);f.context.route={schemaVersion:2,geometry:[[179.999,0],[-179.999,0]],maneuvers:[{geometryIndex:1,cue:'arrive'}]};
 close(f.run('RouteGeometry.compile(route).length'),222.39,0.1);
 close(f.run('RouteGeometry.project([180,0],RouteGeometry.compile(route).segments[0]).fraction'),0.5,0.001);
});
for(const accuracy of [5,10,20,50])test(`GPS ${accuracy}m: reliable fixes follow the curve; degraded fixes cannot invent progress`,()=>{
 const f=matching([[0,0],[100,0],[100,100],[200,100]]);
 f.update(0,0,{accuracy:5});let result;
 for(const [x,y] of [[20,0],[40,0],[60,0],[80,0],[100,0],[100,20],[100,40]])result=f.update(x,y,{accuracy,ms:2000});
 if(accuracy<20){close(result.along,140);assert.equal(result.usable,true)}
 else{assert.equal(result.status,'weak');assert.equal(result.along,0)}
});
for(const speed of [1.4,5,10])test(`walking/cycling ${speed}m/s accumulates actual polyline distance`,()=>{
 const f=matching([[0,0],[200,0]]);f.update(0,0,{speed});let result;
 for(let i=1;i<=10;i++)result=f.update(speed*i,0,{speed});
 close(result.along,speed*10);
});
test('stationary jitter cannot ratchet progress toward a nearby endpoint',()=>{
 const f=matching([[0,0],[100,0]]);f.update(0);for(const x of [20,40,60,80])f.update(x);
 for(let i=0;i<30;i++){const result=f.update(80+(i%3)*5,(i%2)*5,{speed:0});close(result.along,80)}
});
test('parallel return geometry is not selected from a noisy fix before a U-turn',()=>{
 const f=matching([[0,0],[100,0],[100,8],[0,8]]);
 for(const x of [0,20,40,60,80,90])f.update(x,0,{heading:90});
 const result=f.update(95,8,{heading:90});assert.ok(result.along<102,JSON.stringify(result));assert.equal(result.segmentIndex,0);
});
test('a completed U-turn matches the outgoing return leg rather than reversing on the incoming leg',()=>{
 const f=matching([[0,0],[100,0],[100,8],[0,8]]);for(const x of [0,20,40,60,80,95])f.update(x,0,{heading:90});
 f.update(100,8,{heading:0});const result=f.update(85,8,{heading:270});assert.equal(result.segmentIndex,2);close(result.along,123);
});
test('reverse travel decreases actual progress instead of jumping to future route sections',()=>{
 const f=matching([[0,0],[200,0]]);for(const x of [0,20,40,60])f.update(x,0,{heading:90});
 const result=f.update(45,0,{heading:270});close(result.along,45);
});
test('later loop and crossing sections are excluded by ordered reachability',()=>{
 const f=matching([[0,0],[100,0],[100,100],[0,100],[0,5],[100,5]]);
 f.update(0);for(const x of [20,40,60]){const result=f.update(x,5);assert.ok(result.along<100);assert.equal(result.segmentIndex,0)}
});
test('close alternative branches become ambiguous instead of silently jumping ahead',()=>{
 const f=matching([[0,0],[30,0],[30,6],[0,6],[0,12],[60,12]]);
 for(const x of [0,10,20,27])f.update(x,0,{heading:90});
 const result=f.update(28,3,{accuracy:10,speed:null});assert.ok(result.along<45);assert.notEqual(result.segmentIndex,4);
});
test('temporary GPS loss requires three local fixes; long gaps never create a global snap',()=>{
 const f=matching([[0,0],[200,0],[200,200],[0,200],[0,0]]);
 for(const x of [0,20,40])f.update(x);
 const first=f.update(50,0,{ms:10000});assert.equal(first.status,'reacquiring');close(first.along,40);
 assert.equal(f.update(52).status,'reacquiring');close(f.update(55).along,55);
 f.run('matcher.interrupt()');const lost=f.update(0,0,{ms:60000});assert.equal(lost.status,'lost');assert.ok(lost.along<100);
});
test('out-of-order timestamps, implausible jumps and nonfinite fixes do not alter the anchor',()=>{
 const f=matching([[0,0],[100,0]]);f.update(0);f.update(10);
 const invalid=f.update(10000);assert.equal(invalid.status,'invalid');close(invalid.along,10);
 f.context.fix={lat:NaN,lng:0,t:10000,accuracy:5};assert.equal(f.run('matcher.update(fix).status'),'invalid');
});
test('geometry distance, not straight-line proximity, determines the next instruction',()=>{
 const f=engine([[0,0],[100,0],[100,100],[0,100],[0,10]]);f.fix(0);
 assert.ok(f.state().trueDist>380);assert.equal(f.state().condition,'normal');
 assert.equal(f.state().finished,false);close(f.state().progressAlongRoute,0);
});
test('curved road tracking does not trigger off-route from the chord between maneuvers',()=>{
 const f=engine([[0,0],[20,10],[40,30],[60,50],[80,60],[100,60]]);f.fix(0);
 for(const [x,y] of [[20,10],[40,30],[60,50],[80,60]])f.fix(x,y,{ms:2000});
 assert.equal(f.state().offRouteActive,false);assert.ok(f.state().progressAlongRoute>100);
});
test('new-format turn needs outgoing evidence; driving straight triggers a missed-turn hypothesis',()=>{
 const maneuvers=[{geometryIndex:1,cue:'turn',rot:90},{geometryIndex:2,cue:'arrive'}];
 for(const correct of [true,false]){
  const f=engine([[0,0],[100,0],[100,100]],maneuvers);for(const x of [0,20,40,60,80,98,100])f.fix(x);
  assert.equal(f.state().legIndex,0);assert.equal(f.state().confirmHold,false);
  if(correct){f.fix(100,12);f.advance(1200);assert.equal(f.state().legIndex,1)}
  else {for(const x of [120,140,160,180])f.fix(x,0,{ms:2000});assert.equal(f.state().legIndex,0);assert.equal(f.state().offRouteActive,true);assert.ok(f.events().some(e=>e.event_type==='turn_missed'))}
 }
});
test('final arrival requires ordered progress and two endpoint fixes, never start/end proximity on a loop',()=>{
 const f=engine([[0,0],[100,0],[100,100],[0,100],[0,0]]);f.fix(0);f.fix(0);f.advance(1200);assert.equal(f.state().finished,false);
 const simple=engine([[0,0],[50,0],[50,50]]);for(const x of [0,20,40,50])simple.fix(x);
 simple.fix(50,20);simple.fix(50,40);simple.fix(50,49);assert.equal(simple.state().finished,false);
 simple.fix(50,50,{speed:0});simple.advance(1200);assert.equal(simple.state().finished,true);
});
module.exports={document};
test('indistinguishable nearby candidates explicitly report ambiguity and freeze progress',()=>{
 const f=matching([[0,0],[15,0],[15,5],[0,5],[0,10],[30,10]]);
 for(const x of [0,5,10])f.update(x,0,{heading:90});
 const result=f.update(9,5,{accuracy:10,speed:null});assert.equal(result.status,'ambiguous');close(result.along,10);
});
test('geometry off-route needs sustained evidence and recovery requires an actual usable match',()=>{
 const f=engine([[0,0],[200,0]]);for(const x of [0,10,20])f.fix(x);
 f.fix(20,20,{accuracy:5});f.fix(20,40,{accuracy:5});
 for(let i=0;i<3;i++)f.fix(20,45,{ms:100,accuracy:5});assert.equal(f.state().offRouteActive,false);
 for(let i=0;i<3;i++)f.fix(20,45,{ms:1000,accuracy:5});assert.equal(f.state().offRouteActive,true);
 f.fix(20,25,{accuracy:5});f.fix(20,5,{accuracy:5});
 for(let i=0;i<2;i++)f.fix(20,0,{ms:1000,accuracy:5});assert.equal(f.state().offRouteActive,false);
 assert.equal(f.state().recoveryGlyph,'offroute');assert.ok(!f.events().some(e=>e.event_type==='route_updated'));
});
test('being near a later section before start acquisition is waiting, not arrival or off-route',()=>{
 const f=engine([[0,0],[100,0],[100,100]]);
 for(let i=0;i<6;i++)f.fix(100,100);
 assert.equal(f.state().matchStatus,'waiting');assert.equal(f.state().routeStarted,false);assert.equal(f.state().offRouteActive,false);assert.equal(f.state().finished,false);
});
test('accuracy 20m/50m and signal errors interrupt geometry progression until locally reacquired',()=>{
 const f=engine([[0,0],[200,0]]);for(const x of [0,10,20])f.fix(x);
 const before=f.state().progressAlongRoute;
 for(const accuracy of [20,50])f.fix(30,0,{accuracy});close(f.state().progressAlongRoute,before);
 f.run("onFixError({code:2,message:'temporary loss'})");
 f.fix(25);assert.equal(f.state().matchStatus,'reacquiring');close(f.state().progressAlongRoute,before);
 f.fix(26);f.fix(27);assert.equal(f.state().matchStatus,'matched');assert.ok(f.state().progressAlongRoute>before);
});
test('route progress reflects reverse travel and roundabout/provider instructions are escaped',()=>{
 const f=engine([[0,0],[100,0],[100,100]],[{geometryIndex:1,cue:'roundabout',exitNumber:3},{geometryIndex:2,cue:'arrive',instruction:'<img src=x>'}]);
 for(const x of [0,20,40,60])f.fix(x);
 assert.match(f.elements.get('scr').innerHTML,/Exit 3/);
 f.fix(45,0,{heading:270});close(f.state().progressAlongRoute,45);close(f.run('routeFillPct()'),22.5,0.5);
 assert.match(f.run("routeInstruction(ROUTE[1],'act')[1]"),/&lt;img/);
});
test('seeded 5m/10m jitter on a curved cycling trace stays local without false off-route or premature arrival',()=>{
 for(const accuracy of [5,10]){
  const points=Array.from({length:41},(_,i)=>[i*5,30*Math.sin(i/40*Math.PI)]);
  const f=engine(points);f.fix(0,0,{accuracy});let seed=17;
  for(let i=1;i<points.length-4;i++){
   seed=(seed*1664525+1013904223)>>>0;const jitter=(seed/2**32-0.5)*accuracy;
   f.fix(points[i][0],points[i][1]+jitter,{accuracy,speed:5});
   assert.equal(f.state().offRouteActive,false);assert.equal(f.state().finished,false);
  }
  assert.ok(f.state().progressAlongRoute>150);
 }
});
test('malformed standalone matcher input interrupts continuity without throwing or changing the anchor',()=>{
 const f=matching([[0,0],[100,0]]);f.update(0);f.update(10);
 assert.equal(f.run('matcher.update(null).status'),'invalid');
 assert.equal(f.update(12).status,'reacquiring');close(f.run('matcher.anchor.along'),10);
});
test('actual crossing is resolved by order and heading without selecting the later traversal',()=>{
 const f=matching([[0,0],[40,40],[80,0],[40,-40],[0,0],[40,40],[80,80]]);
 f.update(0);let result;
 for(const d of [10,20,30,40])result=f.update(d,d,{heading:45,ms:2000});
 assert.ok(result.along<60);assert.ok(result.segmentIndex<2);
 // The coincident traversal hundreds of metres later must not be selected.
 assert.ok(result.along<200);assert.equal(result.status,'matched');
});
