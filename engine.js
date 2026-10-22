/* Load order: glyphs.js, then render.js, then this file.
   This engine owns `state`, `ROUTE`, and `TOTAL_ROUTE_DIST` — the same globals
   render.js's routeFillPct/routeBarLabel/routeActionDefault&Next/routeMeterDefault&Next
   already expect. It never calls a fork of renderMotion/renderStationary — it drives
   the real ones with real data. */

/* ============ STATE ============
   Same shape renderMotion()/renderStationary() already read. */
const state = {
  context:'motion', condition:'normal', cue:'continue', rot:0, trueDist:0,
  currentSeg:'unknown', jitter:false,
  confidenceFiring:false, confidenceVal:5, recoveryGlyph:'offroute',
  situation:'normal', drivingFromRoute:true, actionInverted:false, meterInverted:false, showFullMap:false,
  legIndex:0, distSoFar:0, stopDwell:0, moveDwell:0, confirmHold:false, finished:false,
  gpsWeak:false, lastFix:null, lastSpeedMps:null,
  offRouteActive:false, offRouteElapsed:0
};
let ROUTE = [];
let TOTAL_ROUTE_DIST = 0;
let recordedRoute = null;   // raw {lat,lng,cue,seg,land,rot,distFromPrevious}[] as saved by record-route.html

let watchId = null;
let tracking = false;
let continuityBroken = true;
let trackingGeneration = 0;
let signalTimer = null;
let waypointCandidateAt = null;
let previousProgressFix = null;
const MAX_FIX_AGE_MS = 5000;
const MAX_SPEED_MPS = 25;
const WAYPOINT_RADIUS_M = 10;
let confirmTimer = null;
let confTimer = null;
let badFixStreak = 0;
let offRouteBadStreak = 0;
let offRouteGoodStreak = 0;
const BAD_ACCURACY_M = 20;
const STOP_SPEED_MPS = 0.5; // GPS jitter while genuinely stationary rarely computes above this
const OFF_ROUTE_ENTER_M = 25;
const OFF_ROUTE_CLEAR_M = 15;
const OFF_ROUTE_CONSECUTIVE_FIXES = 3;

/* ============ HAVERSINE ============ */
function haversineMeters(lat1,lng1,lat2,lng2){
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ============ POINT-TO-SEGMENT DISTANCE ============
   Flat local-plane projection centered on the segment's start point. Corridors here
   run tens to hundreds of metres, where a great-circle cross-track formula and this
   equirectangular approximation agree to sub-centimetre precision — this is simpler
   to read and verify. */
function metersPerDegLng(lat){ return 111320*Math.cos(lat*Math.PI/180); }
function toLocalXY(lat,lng,originLat,originLng){
  return { x:(lng-originLng)*metersPerDegLng(originLat), y:(lat-originLat)*111320 };
}
function pointToSegmentDistance(px,py, ax,ay, bx,by){
  const abx=bx-ax, aby=by-ay;
  const abLenSq=abx*abx+aby*aby;
  let t = abLenSq>0 ? ((px-ax)*abx+(py-ay)*aby)/abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx=ax+abx*t, cy=ay+aby*t;
  return Math.hypot(px-cx, py-cy);
}
function perpendicularDistanceToLeg(lat,lng){
  const prev=recordedRoute[state.legIndex], next=recordedRoute[state.legIndex+1];
  const b=toLocalXY(next.lat,next.lng, prev.lat,prev.lng);
  const p=toLocalXY(lat,lng, prev.lat,prev.lng);
  return pointToSegmentDistance(p.x,p.y, 0,0, b.x,b.y);
}

/* ============ CONDITION BAND (ported from the prototype, unchanged) ============ */
function computeBand(trueDist, prevBand){
  const noise = state.jitter ? Math.sin(Date.now()/340)*8 : 0;
  const measured = trueDist + noise;
  const order=['normal','prepare','commit','act'];
  let raw='normal';
  if(measured<=20) raw='act'; else if(measured<=50) raw='commit'; else if(measured<=300) raw='prepare';
  if(order.indexOf(raw) < order.indexOf(prevBand)){
    const margin={prepare:315,commit:65,act:35}[prevBand];
    if(margin!==undefined && measured<margin) return prevBand;
  }
  return raw;
}

/* ============ ROUTE LOADING ============
   route[0] is just the start coordinate. route[i] for i>=1 is the maneuver point
   ending the leg that started at route[i-1], so ROUTE[i-1] (leg array, 0-indexed
   like the original prototype's ROUTE) = {cue, dist, rot, seg, land} of route[i]. */
function loadRoute(route){
  route=normalizeRoute(route);
  recordedRoute = route;
  ROUTE = route.slice(1).map(wp => ({cue:wp.cue, dist:wp.distFromPrevious, rot:wp.rot||0, seg:wp.seg, land:wp.land||''}));
  TOTAL_ROUTE_DIST = ROUTE.reduce((a,l)=>a+l.dist,0);
}
function targetWaypoint(){
  return recordedRoute[state.legIndex+1];
}

/* ============ CONFIDENCE METER (ported from fireConfidenceAuto, unchanged timing) ============ */
function fireConfidence(val){
  state.confidenceVal=val; state.confidenceFiring=true;
  logEvent('confidence_fired', 'confidence -> '+(CONF_LABEL_BY_N[val]||val));
  clearTimeout(confTimer);
  confTimer=setTimeout(()=>{ state.confidenceFiring=false; render(); },2000);
}

/* ============ CONDITION SETTER (centralizes condition_changed logging) ============
   computeBand runs on every fix and often returns the same band it already had —
   this only logs on an actual change, never on a same-value reassignment. */
function setCondition(newCondition){
  if(state.condition===newCondition) return;
  const prev=state.condition;
  state.condition=newCondition;
  logEvent('condition_changed', prev+' -> '+newCondition);
}

/* ============ STATIONARY DWELL (same 3s-stopped / 2s-moving thresholds, now fed by real speed) ============ */
function updateDwell(speedMps, dt){
  if(speedMps<=STOP_SPEED_MPS){
    state.stopDwell+=dt; state.moveDwell=0;
    if(state.context==='motion' && state.stopDwell>=3000) enterStationary();
  } else {
    state.moveDwell+=dt; state.stopDwell=0;
    if(state.context==='stationary' && state.moveDwell>=2000) exitStationary();
  }
}
function enterStationary(){
  state.context='stationary'; state.situation='normal'; state.drivingFromRoute=true;
  state.actionInverted=false; state.meterInverted=false; state.stopDwell=0;
  logEvent('stationary_entered', '');
}
function exitStationary(){
  state.context='motion'; state.moveDwell=0;
  logEvent('stationary_exited', '');
}

/* ============ WAYPOINT ADVANCE (ported from advanceLeg) ============ */
function advanceWaypoint(){
  const prevLeg=ROUTE[state.legIndex];
  logEvent('waypoint_reached', 'leg '+(state.legIndex+1)+' of '+ROUTE.length+', cue '+prevLeg.cue+(prevLeg.land?' — '+prevLeg.land:''));
  state.distSoFar+=prevLeg.dist;
  state.legIndex+=1;
  state.confirmHold=false; waypointCandidateAt=null; previousProgressFix=null;
  const leg=ROUTE[state.legIndex];
  if(!leg){
    state.finished=true; state.trueDist=0; state.cue='arrive';
    setCondition('confirm');
    logEvent('route_completed', 'All waypoints reached');
    stopTest();
    return;
  }
  state.cue=leg.cue; state.rot=leg.rot||0;
  const t=targetWaypoint();
  state.trueDist = state.lastFix ? haversineMeters(state.lastFix.lat,state.lastFix.lng,t.lat,t.lng) : leg.dist;
  setCondition(leg.cue==='continue' ? 'normal' : computeBand(state.trueDist,'normal'));
  if(prevLeg && prevLeg.seg && leg.seg!==prevLeg.seg) fireConfidence(SEG_N[leg.seg]);
  state.currentSeg=leg.seg;
}
function enterConfirmHold(){
  state.confirmHold=true; setCondition('confirm');
  clearTimeout(confirmTimer);
  confirmTimer=setTimeout(()=>{
    if(!tracking || !state.confirmHold || state.gpsWeak || Date.now()-state.lastFix.t>MAX_FIX_AGE_MS) return;
    advanceWaypoint();
    render();
  },1200);
}
function waypointRadius(){
  return Math.min(WAYPOINT_RADIUS_M,ROUTE[state.legIndex].dist/3);
}
function confirmationPositionValid(){
  if(state.trueDist<=waypointRadius()) return true;
  const target=targetWaypoint(),next=recordedRoute[state.legIndex+2];
  if(!next) return false; // Final arrival cannot be inferred by passing the destination.
  const p=toLocalXY(state.lastFix.lat,state.lastFix.lng,target.lat,target.lng);
  const n=toLocalXY(next.lat,next.lng,target.lat,target.lng);
  return pointToSegmentDistance(p.x,p.y,0,0,n.x,n.y)<=10 && p.x*n.x+p.y*n.y>0;
}
function cancelConfirmation(){
  clearTimeout(confirmTimer); state.confirmHold=false; waypointCandidateAt=null;
  if(!state.offRouteActive) setCondition('normal');
}
function advanceMotionProgress(){
  const leg=ROUTE[state.legIndex], target=targetWaypoint(), fix=state.lastFix;
  const dist=haversineMeters(fix.lat,fix.lng,target.lat,target.lng);
  state.trueDist=dist;
  // Never silently start at a later crossing or at the destination of a loop.
  if(!state.routeStarted){
    if(haversineMeters(fix.lat,fix.lng,recordedRoute[0].lat,recordedRoute[0].lng)>Math.min(25,ROUTE[0].dist/2)) return;
    state.routeStarted=true;
    logEvent('route_started', 'Start coordinate acquired');
  }
  let passed=false;
  if(previousProgressFix && state.legIndex<ROUTE.length-1){
    const a=toLocalXY(previousProgressFix.lat,previousProgressFix.lng,target.lat,target.lng);
    const b=toLocalXY(fix.lat,fix.lng,target.lat,target.lng);
    const next=recordedRoute[state.legIndex+2];
    const n=toLocalXY(next.lat,next.lng,target.lat,target.lng);
    // Sparse samples may cross a waypoint, but a missed turn must not count as a turn.
    passed=pointToSegmentDistance(0,0,a.x,a.y,b.x,b.y)<=8 &&
      pointToSegmentDistance(b.x,b.y,0,0,n.x,n.y)<=10 && b.x*n.x+b.y*n.y>0;
  }
  previousProgressFix=fix;
  const near=dist<=waypointRadius();
  if(near && waypointCandidateAt===null) waypointCandidateAt=fix.t;
  if(!near) waypointCandidateAt=null;
  if(passed || (near && fix.t-waypointCandidateAt>=1000)){
    if(leg.cue==='continue') advanceWaypoint();
    else enterConfirmHold();
  } else {
    setCondition(leg.cue==='continue' ? 'normal' : computeBand(dist,state.condition));
  }
}

/* ============ OFF-ROUTE DETECTION ============
   Three consecutive reliable fixes beyond 25m enter caution; three within 15m
   clear it. Geometry is the current recorded straight leg, not a road network.
   Stay on the off-route message until actual recovery; no reroute is fabricated. */
function enterOffRoute(){
  cancelConfirmation(); previousProgressFix=null;
  state.offRouteActive=true; state.offRouteElapsed=0; state.recoveryGlyph='offroute';
  setCondition('caution');
  offRouteBadStreak=0; offRouteGoodStreak=0;
  logEvent('off_route_entered', '');
  if(state.legIndex>0 && ROUTE[state.legIndex-1].cue!=='continue') logEvent('turn_missed', 'Possible missed turn; left the outgoing corridor');
}
function exitOffRoute(){
  state.offRouteActive=false; state.offRouteElapsed=0;
  offRouteBadStreak=0; offRouteGoodStreak=0;
  const leg=ROUTE[state.legIndex];
  setCondition((leg && leg.cue!=='continue') ? computeBand(state.trueDist,'normal') : 'normal');
  logEvent('off_route_cleared', '');
}
function checkOffRoute(lat,lng,dt){
  if(state.finished || !ROUTE[state.legIndex]) return;
  const dist=perpendicularDistanceToLeg(lat,lng);
  if(state.offRouteActive){
    state.offRouteElapsed+=dt;

    if(dist<=OFF_ROUTE_CLEAR_M){
      offRouteGoodStreak+=1;
      if(offRouteGoodStreak>=OFF_ROUTE_CONSECUTIVE_FIXES) exitOffRoute();
    } else {
      offRouteGoodStreak=0;
    }
  } else {
    if(dist>OFF_ROUTE_ENTER_M){
      offRouteBadStreak+=1;
      if(offRouteBadStreak>=OFF_ROUTE_CONSECUTIVE_FIXES) enterOffRoute();
    } else {
      offRouteBadStreak=0;
    }
  }
}

/* ============ GEOLOCATION ============ */
function resetContinuity(){
  continuityBroken=true;
  state.stopDwell=0; state.moveDwell=0;
  offRouteBadStreak=0; offRouteGoodStreak=0;
  previousProgressFix=null; waypointCandidateAt=null;
  if(state.confirmHold) cancelConfirmation();
}
function flagWeakSignal(note,fix){
  resetContinuity();
  if(!state.gpsWeak){ state.gpsWeak=true; logEvent('gps_weak_flagged',note,fix); }
  render();
}
function armSignalTimeout(){
  clearTimeout(signalTimer);
  signalTimer=setTimeout(()=>{ if(tracking) flagWeakSignal('No reliable GPS fix for 5 seconds'); },MAX_FIX_AGE_MS);
}
function onFix(pos){
  if(!tracking || state.finished) return;
  const c=pos && pos.coords, now=pos && pos.timestamp;
  if(!c || !validCoordinate(c.latitude,c.longitude) || !Number.isFinite(c.accuracy) || c.accuracy<0 ||
      !Number.isFinite(now) || now>Date.now()+1000 || Date.now()-now>MAX_FIX_AGE_MS ||
      (state.lastFix && now<=state.lastFix.t)){
    resetContinuity(); return;
  }
  if(c.accuracy>=BAD_ACCURACY_M){
    resetContinuity(); badFixStreak+=1;
    if(badFixStreak>=5) flagWeakSignal('Poor GPS accuracy for '+badFixStreak+' consecutive fixes',
      {lat:c.latitude,lng:c.longitude,accuracy:c.accuracy});
    return;
  }
  const previous=state.lastFix;
  const gap=previous ? now-previous.t : 0;
  const continuous=previous && gap<=MAX_FIX_AGE_MS && !state.gpsWeak && !continuityBroken;
  const distance=previous ? haversineMeters(previous.lat,previous.lng,c.latitude,c.longitude) : 0;
  if(previous && distance>MAX_SPEED_MPS*gap/1000+previous.accuracy+c.accuracy){
    flagWeakSignal('Implausible GPS jump rejected'); return;
  }
  if(!continuous) resetContinuity();
  let speedMps=Number.isFinite(c.speed) && c.speed>=0 && c.speed<=MAX_SPEED_MPS ? c.speed : null;
  if(speedMps===null && continuous){
    speedMps=distance<=Math.max(previous.accuracy,c.accuracy) ? 0 : distance/(gap/1000);
  }
  state.lastFix={lat:c.latitude,lng:c.longitude,t:now,accuracy:c.accuracy};
  state.lastSpeedMps=speedMps;
  continuityBroken=false;
  badFixStreak=0;
  if(state.gpsWeak){ state.gpsWeak=false; logEvent('gps_recovered','Reliable GPS resumed'); }
  armSignalTimeout();
  if(continuous && speedMps!==null) updateDwell(speedMps,gap);
  if(continuous) checkOffRoute(c.latitude,c.longitude,gap);
  if(state.routeStarted){
    const target=targetWaypoint();
    if(target) state.trueDist=haversineMeters(c.latitude,c.longitude,target.lat,target.lng);
  }
  if(state.confirmHold && (state.offRouteActive || !confirmationPositionValid())) cancelConfirmation();
  // Arrival also works while stopped; dwell must not prevent detection at the destination.
  if(!state.finished && !state.confirmHold && !state.offRouteActive) advanceMotionProgress();
  render();
}
function onFixError(err){
  if(!tracking) return;
  logEvent('gps_error', 'code '+err.code+': '+err.message);
  flagWeakSignal('GPS error '+err.code);
}

/* ============ RENDER DISPATCH ============
   Calls the unmodified renderMotion()/renderStationary() from render.js. */
let onEngineUpdate = null;
function setEngineUpdateHandler(fn){ onEngineUpdate=fn; }
function render(){
  if(state.context==='motion' && state.gpsWeak) renderMotionOverlay();
  else if(state.context==='motion') renderMotion();
  else renderStationary();
  if(onEngineUpdate) onEngineUpdate(state);
}

/* ============ START / STOP ============ */
function startTest(route){
  const validated=normalizeRoute(route); // Validate before interrupting a live session.
  stopTest();
  loadRoute(validated);
  tracking=true;
  const generation=++trackingGeneration;
  Object.assign(state,{
    context:'motion', condition:'normal', cue:ROUTE[0].cue, rot:ROUTE[0].rot||0,
    trueDist:ROUTE[0].dist, currentSeg:ROUTE[0].seg, jitter:false,
    confidenceFiring:false, confidenceVal:5, recoveryGlyph:'offroute',
    situation:'normal', drivingFromRoute:true, actionInverted:false, meterInverted:false, showFullMap:false,
    legIndex:0, distSoFar:0, stopDwell:0, moveDwell:0, confirmHold:false, finished:false,
    gpsWeak:false, lastFix:null, lastSpeedMps:null, routeStarted:false,
    offRouteActive:false, offRouteElapsed:0
  });
  badFixStreak=0; offRouteBadStreak=0; offRouteGoodStreak=0;
  render();
  armSignalTimeout();
  watchId=navigator.geolocation.watchPosition(
    pos=>{if(tracking && generation===trackingGeneration) onFix(pos);},
    err=>{if(tracking && generation===trackingGeneration) onFixError(err);},
    {enableHighAccuracy:true, maximumAge:1000, timeout:5000});
}
function stopTest(){
  tracking=false; continuityBroken=true; trackingGeneration+=1;
  clearTimeout(signalTimer);
  state.confirmHold=false; waypointCandidateAt=null; previousProgressFix=null;
  if(watchId!=null){ navigator.geolocation.clearWatch(watchId); watchId=null; }
  clearTimeout(confirmTimer); clearTimeout(confTimer);
}

/* ============ INTERACTION STUBS ============
   renderStationary()'s markup references these by name (onclick="tapAction()" etc.).
   The tap/interaction layer isn't built yet — these are inert placeholders so the
   engine can be exercised without console errors. */
function tapAction(){ logEvent('action_card_tapped', ''); }
function tapMeter(){ logEvent('meter_card_tapped', ''); }
function tapMap(){}
function ctrlTap(){}
function closeFullMap(){ state.showFullMap=false; render(); }
