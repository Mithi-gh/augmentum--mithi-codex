const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
function fixture({preflight=false,storageFails=false}={}){
  let now=100000, id=0;
  const timers=new Map(), watches=new Map(), elements=new Map(), storage=new Map();
  function element(){return {innerHTML:'',textContent:'',style:{},className:'',content:'',classList:{toggle(){},add(){},remove(){}},getAttribute(){return this.content},setAttribute(k,v){this[k]=v}}}
  const document={visibilityState:'visible',documentElement:element(),head:{appendChild(){}},
    getElementById(k){if(!elements.has(k))elements.set(k,element());return elements.get(k)},
    querySelector(){return element()},addEventListener(){}};
  const context=vm.createContext({console:{log(){},warn(){},error(){}},document,screen:{},
    Date:class extends Date{static now(){return now}},
    setTimeout(fn,delay){const key=++id;timers.set(key,{fn,at:now+delay});return key},clearTimeout(key){timers.delete(key)},
    navigator:{geolocation:{watchPosition(ok,error){const key=++id;watches.set(key,{ok,error});return key},clearWatch(key){watches.delete(key)}}},
    localStorage:{getItem(k){return storage.get(k)??null},setItem(k,v){if(storageFails)throw Error('Quota exceeded');storage.set(k,v)}}});
  const run=s=>vm.runInContext(s,context);
  for(const file of ['glyphs.js','render.js','route.js','geometry.js','map-matcher.js','engine.js','log.js',...(preflight?['preflight.js']:[])]) run(fs.readFileSync(path.join(root,file),'utf8'));
  function advance(ms){const end=now+ms;while(true){let next;for(const [key,value]of timers)if(value.at<=end && (!next||value.at<next[1].at))next=[key,value];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn()}now=end}
  function fix(x,y=0,{ms=1000,accuracy=3,speed=4,timestamp,...coords}={}){
    advance(ms); const pos={timestamp:timestamp??now,coords:{latitude:y/111320,longitude:x/111320,accuracy,speed,...coords}};
    context.pos=pos;run('onFix(pos)'); return pos;
  }
  function route(points=[[0,0,'continue'],[100,0,'continue'],[100,100,'arrive']]){
    return points.map(([x,y,cue])=>({lat:y/111320,lng:x/111320,cue,seg:'quiet',rot:cue==='turn'?90:0,distFromPrevious:99999}));
  }
  function start(points){context.input=route(points);run("startSession('test'); startTest(input)")}
  return {run,advance,fix,route,start,context,watches,storage,elements,now:()=>now,
    state:()=>JSON.parse(run('JSON.stringify(state)')),events:()=>JSON.parse(run('JSON.stringify(getLogRecords())'))};
}
module.exports={fixture,root};
