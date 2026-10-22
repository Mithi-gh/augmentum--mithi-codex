/* Load order: glyphs.js must load before this file (uses ARROW/KEEP/FORK/MERGE/EXIT/ROUNDABOUT/REVERSE/ARRIVE/REC).
   routeFillPct, routeBarLabel, routeActionDefault/Next, routeMeterDefault/Next, and nextRouteLeg
   reference ROUTE, TOTAL_ROUTE_DIST, and state.* fields that the ride engine must supply. */

/* ============ LOOKUP TABLES ============ */
const COPY = {
  continue:{rest:[null,'Continue',''],prepare:[null,'Continue',''],commit:[null,'Continue',''],act:[null,'Straight through',''],confirm:[null,'On route','']},
  bear:{rest:[null,'Bear ahead',''],prepare:[null,'Prepare to bear left',''],commit:[null,'Bear left',''],act:[null,'Bear left',''],confirm:[null,'On route','']},
  turn:{rest:[null,'Turn ahead',''],prepare:[null,'Prepare left',''],commit:[null,'Left','Move across when clear'],act:[null,'Turn left',''],confirm:[null,'On route','']},
  sharp:{rest:[null,'Sharp turn ahead',''],prepare:[null,'Prepare sharp left','Slow before the turn'],commit:[null,'Sharp left','Slow down now'],act:[null,'Turn left',''],confirm:[null,'On route','']},
  keep:{rest:[null,'Keep left ahead',''],prepare:[null,'Prepare to keep left',''],commit:[null,'Keep left',''],act:[null,'Keep left',''],confirm:[null,'On route','']},
  fork:{rest:[null,'Fork ahead',''],prepare:[null,'Left at the fork',''],commit:[null,'Take left fork',''],act:[null,'Left fork',''],confirm:[null,'On route','']},
  merge:{rest:[null,'Merge ahead',''],prepare:[null,'Prepare to merge',''],commit:[null,'Merge right','Check over shoulder'],act:[null,'Merge now',''],confirm:[null,'On route','']},
  exit:{rest:[null,'Exit ahead',''],prepare:[null,'Prepare to exit',''],commit:[null,'Take the exit',''],act:[null,'Exit now',''],confirm:[null,'On route','']},
  roundabout:{rest:[null,'Roundabout ahead',''],prepare:[null,'2nd exit',''],commit:[null,'2nd exit',''],act:[null,'Take 2nd exit',''],confirm:[null,'On route','']},
  reverse:{rest:[null,'Turn around when safe',''],prepare:[null,'Turn around when safe',''],commit:[null,'Turn around when safe',''],act:[null,'Turn around when safe',''],confirm:[null,'Back on route','']},
  arrive:{rest:[null,'Arriving',''],prepare:[null,'Arriving','Stop on the left when safe'],commit:[null,'Destination','Stop on the left when safe'],act:[null,'Arrived','Bike parking nearby'],confirm:[null,'Arrived','']}
};
const CUE_GLYPH = {continue:ARROW,bear:ARROW,turn:ARROW,sharp:ARROW,keep:KEEP,fork:FORK,merge:MERGE,exit:EXIT,roundabout:ROUNDABOUT,reverse:REVERSE,arrive:ARRIVE};
const CUE_ROT = {continue:0,bear:-45,turn:-90,sharp:-135,keep:-90,fork:-45,merge:90,exit:90,roundabout:0,reverse:0,arrive:0};
const CUE_LABEL = {continue:'Continue',bear:'Bear',turn:'Turn',sharp:'Sharp turn',keep:'Keep',fork:'Fork',merge:'Merge',exit:'Exit',roundabout:'Roundabout',reverse:'Reverse',arrive:'Arrive'};
const CONF_LABEL_BY_N = {0:'Not surveyed',2:'Mixed traffic',3:'Painted lane',4:'Quiet street',5:'Protected lane'};
const SEG_N = {protected:5,quiet:4,painted:3,mixed:2,unknown:0};
const SEG_LABEL = {protected:'Protected lane',quiet:'Quiet street',painted:'Painted lane',mixed:'Mixed traffic',unknown:'Not surveyed'};

/* ============ STATIONARY MANUAL SITUATIONS ============ */
const SIT_DATA = {
  offroute:{map:'off',maptag:'You are here',fill:46,blabel:'12 min · 2.8 km · arrive 18:47',
    act:{g:REC.offroute.g,rot:0,d:'120m',i:'Off route',c:'Rejoin behind you'},
    act2:{g:ARROW,rot:0,d:'',i:'Or take a new route',c:''},
    meter:[0,'Not surveyed','current'],meter2:[3,'Painted lane','in 120m'],
    ctrls:[['Rejoin','cau'],['Reroute','']],caution:true},
  destination:{map:'dest',maptag:'Destination',fill:94,blabel:'2 min · 400 m · arrive 18:42',
    act:{g:ARRIVE,rot:0,d:'400m',i:'Arriving',c:'Stop on the left when safe'},
    act2:{g:ARRIVE,rot:0,d:'',i:'Bike parking past entrance',c:''},
    meter:[4,'Quiet street','for 400m'],meter2:[5,'Protected lane','at arrival'],
    ctrls:[['Parking','pri'],['End route','']]},
  paused:{map:'norm',maptag:'Paused',fill:46,blabel:'Paused · 2.8 km remaining',
    act:{g:ARROW,rot:-90,d:'90m',i:'Next: left',c:'Resume when ready'},
    act2:{g:ARROW,rot:90,d:'130m',i:'Then right',c:''},
    meter:[5,'Protected lane','for 400m'],meter2:[2,'Mixed traffic','then 250m'],
    ctrls:[['Resume','pri'],['End route','']]},
  hazard:{map:'haz',maptag:'Ahead 400m',fill:46,blabel:'13 min · 2.8 km · arrive 18:44',
    act:{g:REC.caution.g,rot:0,d:'400m',i:'Cycle lane blocked',c:'Reported by 3 riders today'},
    act2:{g:ARROW,rot:-90,d:'90m',i:'Left before hazard',c:''},
    meter:[5,'Protected lane','for 400m'],meter2:[2,'Mixed traffic','then 250m'],
    ctrls:[['Avoid','pri'],['Report','']],dormant:true}
};

/* ============ HELPERS ============ */
function fmtDistance(m){
  if(m===null||m===undefined) return null;
  if(m<1000) return {num:Math.round(m/10)*10,unit:'m',km:false};
  return {num:(m/1000).toFixed(1),unit:'km',km:true};
}
function ticksHtml(n){
  if(n===0)return '<div class="ticks">'+'<i class="tick dash"></i>'.repeat(5)+'</div>';
  let t='';for(let i=0;i<5;i++)t+=`<i class="tick${i<n?'':' off'}"></i>`;
  return `<div class="ticks">${t}</div>`;
}
function barHtml(f,label,mut){
  f=Math.max(0,Math.min(100,f));
  return `<div class="barwrap"><div class="bar">
    <div class="bfill" style="width:${f}%;${mut?'background:rgba(255,255,255,.4)':''}"></div>
    <div class="blab lt">${label}</div>
    <div class="blab dk" style="clip-path:inset(0 ${100-f}% 0 0)">${label}</div></div></div>`;
}
function mapSvg(kind){
  const line=kind==='off'?'#FFF86A':'#3EA8FF';
  const dot=kind==='off'?'#FFF86A':'#FFFFFF';
  let route=`<path d="M40 340 L40 200 Q40 178 62 178 L212 178 Q234 178 234 156 L234 40" stroke="${line}" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  if(kind==='off') route=`<path d="M40 340 L40 200 Q40 178 62 178 L212 178 Q234 178 234 156 L234 40" stroke="rgba(255,248,106,.30)" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M40 340 L118 340 L118 268" stroke="${line}" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 18"/>`;
  const pos=kind==='off'?`<circle cx="118" cy="268" r="14" fill="${dot}"/>`:`<circle cx="40" cy="300" r="14" fill="${dot}"/>`;
  const marker=kind==='haz'?`<circle cx="234" cy="128" r="16" fill="#FFF86A"/><path d="M234 119 V133" stroke="#0E0E0E" stroke-width="5" stroke-linecap="round"/>`
    :kind==='dest'?`<circle cx="234" cy="62" r="15" fill="none" stroke="#3EA8FF" stroke-width="8"/>`:'';
  return `<svg class="m" viewBox="0 0 300 380" preserveAspectRatio="xMidYMid slice">
    <path d="M0 178 H300 M40 0 V380 M234 0 V380" stroke="rgba(255,255,255,.07)" stroke-width="28"/>${route}${marker}${pos}</svg>`;
}
function expandIcon(){
  return `<svg viewBox="0 0 100 100" width="20" height="20"><path d="M58 18 H82 V42 M42 82 H18 V58" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M82 18 L56 44 M18 82 L44 56" stroke="#fff" stroke-width="10" stroke-linecap="round"/></svg>`;
}
function maneuverCopy(cue,band,rot){
  const copy=COPY[cue][band]||COPY[cue].rest;
  return rot && CUE_ROT[cue] && Math.sign(rot)!==Math.sign(CUE_ROT[cue])
    ? copy.map(v=>typeof v==='string'?v.replace(/left|right/g,w=>w==='left'?'right':'left'):v) : copy;
}
function routeInstruction(leg,band){
  const copy=[...maneuverCopy(leg?.cue||state.cue,band,leg?.rot??state.rot)];
  if(leg?.instruction)copy[1]=escapeHtml(leg.instruction);
  else if(leg?.cue==='roundabout' && leg.exitNumber)copy[1]=(band==='act'?'Take exit ':'Exit ')+leg.exitNumber;
  return copy;
}
function bandKey(c){ return c==='normal'?'rest':c; }
function setBorder(kind){
  const b=document.getElementById('brd');
  b.className='brd'+(kind==='off'?'':kind==='yellow'?' yellow steady':' '+kind);
}

/* ============ ROUTE-DERIVED HELPERS ============
   These read ROUTE, TOTAL_ROUTE_DIST and state.legIndex/trueDist/distSoFar/drivingFromRoute,
   which the ride engine (not part of the display layer) is responsible for defining. */
function nextRouteLeg(){
  for(let i=state.legIndex+1;i<ROUTE.length;i++){ if(!ROUTE[i].stop) return ROUTE[i]; }
  return null;
}
function routeFillPct(){
  if(!state.drivingFromRoute) return 46;
  const leg=ROUTE[state.legIndex];
  const done = state.geometryAware ? state.progressAlongRoute : state.distSoFar + (leg&&!leg.stop ? (leg.dist-state.trueDist) : 0);
  return TOTAL_ROUTE_DIST>0 ? Math.max(0,Math.min(100,100*done/TOTAL_ROUTE_DIST)) : 0;
}
function routeBarLabel(){
  if(!state.drivingFromRoute) return '12 min · 2.8 km · 46%';
  const pct=Math.round(routeFillPct());
  const remainKm=(TOTAL_ROUTE_DIST*(1-routeFillPct()/100)/1000).toFixed(1);
  return `${remainKm} km left · ${pct}%`;
}
function routeActionDefault(){
  const leg=ROUTE[state.legIndex];
  if(!leg) return {g:ARRIVE,rot:0,d:'',i:'Arrived',c:''};
  const cp = routeInstruction(leg,bandKey(state.condition));
  const d=fmtDistance(Math.round(state.trueDist));
  return {g:CUE_GLYPH[leg.cue], rot:leg.rot||0, d:d?`${d.num}${d.unit}`:'', i:cp[1], c:cp[2]};
}
function routeActionNext(){
  const leg=nextRouteLeg();
  if(!leg) return {g:ARRIVE, rot:0, d:'', i:'End of route', c:''};
  return {g:CUE_GLYPH[leg.cue], rot:leg.rot||0, d:leg.dist+'m', i:routeInstruction(leg,'rest')[1], c:escapeHtml(leg.land||'')};
}
function routeMeterDefault(){
  const leg=ROUTE[state.legIndex];
  return leg ? [SEG_N[leg.seg],SEG_LABEL[leg.seg],'for '+Math.round(state.trueDist)+'m'] : [0,'Not surveyed',''];
}
function routeMeterNext(){
  const leg=nextRouteLeg();
  if(!leg) return [0,'Not surveyed',''];
  return [SEG_N[leg.seg], SEG_LABEL[leg.seg], 'then '+leg.dist+'m'];
}

/* ============ RENDER: MOTION ============ */
function renderMotion(){
  const c=state.condition;
  let html='';
  if(c==='caution'){
    const r=REC[state.recoveryGlyph];
    html+=`${r.unlocked?'<div class="badge">Unlocked copy</div>':''}
      <div class="motionwrap"><div class="conf"></div>
        <div class="gbox"><svg viewBox="0 0 100 100">${r.g.replace(/class="gs"/g,'class="gs" style="stroke:#FFF86A"')}</svg></div>
        <div class="tg"><div class="instr" style="color:#FFF86A">${r.i}</div><div class="ctx">${r.c}</div></div>
      </div>${barHtml(routeFillPct(),routeBarLabel(),true)}`;
    setBorder('yellow');
  } else {
    const cp=routeInstruction(ROUTE[state.legIndex],bandKey(c));
    const d=fmtDistance(c==='act'?null:Math.round(state.trueDist));
    const rot=state.rot||0;
    const glyphColor = c==='normal'?'#fff':c==='confirm'?'rgba(255,255,255,.56)':'var(--accent)';
    const isAct = c==='act';
    html+=`<div class="motionwrap">
        <div class="conf ${state.confidenceFiring?'on':''}">${CONF_LABEL_BY_N[state.confidenceVal]}</div>
        <div class="gbox ${isAct?'act':''}"><svg viewBox="0 0 100 100" style="color:${glyphColor}">
          <g transform="rotate(${rot} 50 52)" stroke="${glyphColor}">${CUE_GLYPH[state.cue]}</g></svg></div>
        <div class="tg">
          ${d?`<div class="dist ${d.km?'km':''}" style="color:${glyphColor}">${d.num}<span class="u">${d.unit}</span></div>`:''}
          <div class="instr ${isAct?'act-size':''}" style="color:${glyphColor}">${cp[1]}</div>
          ${cp[2]?`<div class="ctx">${cp[2]}</div>`:''}
        </div>
      </div>${barHtml(routeFillPct(),routeBarLabel(),false)}`;
    if(c==='normal'||c==='confirm') setBorder('off');
    else setBorder(c==='prepare'?'p1':c==='commit'?'p2':'p3');
  }
  document.getElementById('scr').innerHTML=html;
  document.getElementById('scr').className='scr'+(c==='caution'?' caution-pad':'');
}

/* ============ RENDER: STATIONARY ============ */
function renderStationary(sOverride){
  if(state.showFullMap){ renderFullMap(); return; }
  document.getElementById('fullmapview').style.display='none';
  let s;
  if(state.condition==='caution' || state.gpsWeak || state.matchUncertain){
    /* Caution overrides tone unconditionally: off-route wins over whatever situation,
       override param, or drivingFromRoute state was already on screen. Reuses the
       manual SIT_DATA.offroute card wholesale (its map/ctrls/caution tone are already
       exactly this case) and swaps in the live recovery glyph + copy from REC, the
       same lookup renderMotion's caution branch already reads off state.recoveryGlyph. */
    const r=REC[state.gpsWeak?'signal':state.offRouteActive?state.recoveryGlyph:'matching'];
    s=Object.assign({}, SIT_DATA.offroute, { act:{g:r.g, rot:0, d:'', i:r.i, c:r.c}, act2:{g:r.g,rot:0,d:'',i:r.i,c:r.c}, fill:routeFillPct(),blabel:routeBarLabel(),meter:[0,'Not surveyed',''],meter2:[0,'Not surveyed',''],ctrls:[] });
  }
  else if(sOverride){ s=sOverride; }
  else if(state.drivingFromRoute && state.situation==='normal'){
    s={ map:'norm', maptag:'Next '+Math.round(state.trueDist)+'m', fill:routeFillPct(), blabel:routeBarLabel(),
        act:routeActionDefault(), act2:routeActionNext(), meter:routeMeterDefault(), meter2:routeMeterNext(),
        ctrls:[['Reroute','pri'],['Report','']] };
  } else if(state.situation==='normal'){
    s={ map:'norm', maptag:'Next 400m', fill:46, blabel:'12 min · 2.8 km · arrive 18:42',
        act:{g:ARROW,rot:-90,d:'90m',i:'Prepare left',c:'After Blackfriars Bridge'},
        act2:{g:ARROW,rot:90,d:'130m',i:'Then right',c:'Before the junction'},
        meter:[5,'Protected lane','for 400m'], meter2:[2,'Mixed traffic','then 250m'],
        ctrls:[['Reroute','pri'],['Report','']] };
  } else { s=SIT_DATA[state.situation]; }

  const caution=!!s.caution;
  const tone = caution?'#FFF86A':'#3EA8FF';
  const a=state.actionInverted?s.act2:s.act;
  const m=state.meterInverted?s.meter2:s.meter;
  const actFill=state.actionInverted?tone:'var(--raised)';
  const actText=state.actionInverted?'#00131F':tone;
  const metFill=state.meterInverted?'#F3F4F5':'var(--raised)';
  const metText=state.meterInverted?'#0A0C0E':'#fff';
  const metMuted=state.meterInverted?'rgba(10,12,14,.44)':'rgba(255,255,255,.44)';

  const html=`${s.dormant?'<div class="badge">Dormant, reserved</div>':''}
    <div class="map" onclick="tapMap()">${mapSvg(s.map)}<div class="expand">${expandIcon()}</div>
      <span class="maptag">${s.maptag}</span></div>
    <div class="actcard" style="background:${actFill}" onclick="tapAction()">
      <div class="actrow">
        <svg viewBox="0 0 100 100" style="color:${actText}"><g transform="rotate(${a.rot||0} 50 52)" stroke="${actText}">${a.g}</g></svg>
        <div class="adist" style="color:${actText}">${a.d||''}</div>
        <div>${state.actionInverted?`<div class="tag" style="color:rgba(0,19,31,.5)">Then</div>`:''}
          <div class="ainstr" style="color:${actText}">${a.i}</div>
          ${a.c?`<div class="actx" style="color:${state.actionInverted?'rgba(0,19,31,.68)':'var(--t2)'}">${a.c}</div>`:''}
        </div>
      </div>
    </div>
    <div class="metcard" style="background:${metFill}" onclick="tapMeter()">
      <div class="mtop">
        <span class="mlab" style="color:${metText}">${state.meterInverted?'<span class="pre">Next</span>':''}${m[1]}</span>
        <span class="mdist" style="color:${metMuted}">${m[2]}</span>
      </div>
      ${ticksHtml(m[0]).replace(/class="tick"/g, state.meterInverted?'class="tick" style="background:#0A0C0E"':'class="tick"')
                        .replace(/class="tick off"/g, state.meterInverted?'class="tick off" style="background:rgba(10,12,14,.16)"':'class="tick off"')
                        .replace(/class="tick dash"/g, state.meterInverted?'class="tick dash" style="border-top-color:rgba(10,12,14,.5)"':'class="tick dash"')}
    </div>
    ${barHtml(s.fill, s.blabel, caution)}
    <div class="ctrls2">${s.ctrls.map(c=>`<div class="pbtn ${c[1]}" onclick="ctrlTap('${c[0]}')">${c[0]}</div>`).join('')}</div>`;
  document.getElementById('scr').innerHTML=html;
  document.getElementById('scr').className='scr';
  setBorder(caution?'yellow':'off');
}
function renderFullMap(){
  setBorder('off');
  document.getElementById('scr').innerHTML='';
  const fm=document.getElementById('fullmapview');
  fm.style.display='block';
  const leg = state.drivingFromRoute ? ROUTE[state.legIndex] : SIT_DATA[state.situation]||{map:'norm',act:{g:ARROW,rot:-90,d:'90m',i:'Prepare left'}};
  const mapKind = state.drivingFromRoute ? 'norm' : (SIT_DATA[state.situation]?SIT_DATA[state.situation].map:'norm');
  const actD = state.drivingFromRoute ? Math.round(state.trueDist)+'m' : (SIT_DATA[state.situation]?SIT_DATA[state.situation].act.d:'90m');
  const actI = state.drivingFromRoute ? (state.finished?'Arrived':state.gpsWeak?REC.signal.i:state.matchUncertain&&!state.offRouteActive?REC.matching.i:state.condition==='caution'?REC[state.recoveryGlyph].i:routeInstruction(ROUTE[state.legIndex],bandKey(state.condition))[1]) : (SIT_DATA[state.situation]?SIT_DATA[state.situation].act.i:'Prepare left');
  const rot = state.drivingFromRoute ? (state.rot||0) : 0;
  fm.innerHTML=`${mapSvg(mapKind)}
    <div class="fmback" onclick="closeFullMap()">
      <svg viewBox="0 0 100 100" width="24" height="24"><path d="M62 20 L30 50 L62 80" stroke="#fff" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="fmcard"><div class="actrow">
      <svg viewBox="0 0 100 100" style="color:#3EA8FF"><g transform="rotate(${rot} 50 52)" stroke="#3EA8FF">${ARROW}</g></svg>
      <div class="adist" style="color:#3EA8FF">${actD}</div>
      <div class="ainstr" style="color:#3EA8FF">${actI}</div>
    </div></div>`;
}

function renderMotionOverlay(){
  const key = state.gpsWeak ? 'signal' : state.offRouteActive ? 'offroute' : state.matchUncertain ? 'matching' : state.eventStageName || 'offroute';
  const r = REC[key] || REC.offroute;
  const html = `${r.unlocked?'<div class="badge">Unlocked copy</div>':''}
    <div class="motionwrap"><div class="conf"></div>
      <div class="gbox"><svg viewBox="0 0 100 100">${r.g.replace(/class="gs"/g,'class="gs" style="stroke:#FFF86A"')}</svg></div>
      <div class="tg"><div class="instr" style="color:#FFF86A">${r.i}</div><div class="ctx">${r.c}</div></div>
    </div>${barHtml(routeFillPct(),routeBarLabel(),true)}`;
  document.getElementById('scr').innerHTML=html;
  document.getElementById('scr').className='scr caution-pad';
  setBorder('yellow');
}
