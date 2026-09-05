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
const OFF_ROUTE_STAGE_MS = 2400; // same per-stage cadence as the original eventOverlay demo

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
  state.distSoFar+=prevLeg.dist;
  state.legIndex+=1;
  state.confirmHold=false;
  const leg=ROUTE[state.legIndex];
  if(!leg){
    state.finished=true;
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
    if(!state.confirmHold) return;
    advanceWaypoint();
    render();
  },1200);
}
function advanceMotionProgress(fixAccuracy){
  const leg=ROUTE[state.legIndex];
  const t=targetWaypoint();
  const dist=haversineMeters(state.lastFix.lat,state.lastFix.lng,t.lat,t.lng);
  state.trueDist=dist;
  if(dist<=fixAccuracy){
    logEvent('waypoint_reached', 'leg '+(state.legIndex+1)+' of '+ROUTE.length+', cue '+leg.cue+(leg.land?' — '+leg.land:''));
    if(leg.cue==='continue') advanceWaypoint();
    else enterConfirmHold();
  } else {
    setCondition(leg.cue==='continue' ? 'normal' : computeBand(dist,state.condition));
  }
}

/* ============ OFF-ROUTE DETECTION ============
   Enter at 25m perpendicular distance from the current leg's line segment, held for
   3 consecutive fixes; clear at 15m, also held for 3 consecutive fixes. Different
   thresholds so the recovery state doesn't flicker right at the boundary, same as
   computeBand's hysteresis margins do for distance bands. While active, condition is
   pinned to 'caution' and recoveryGlyph walks offroute -> rerouting -> updated on the
   same ~2.4s-per-stage cadence the original eventOverlay demo used, then holds at
   'updated' until the rider is actually back on the line (unlike the demo, which was
   time-boxed for a scripted show-and-tell). */
function offRouteStageForElapsed(ms){
  if(ms<OFF_ROUTE_STAGE_MS) return 'offroute';
  if(ms<OFF_ROUTE_STAGE_MS*2) return 'rerouting';
  return 'updated';
}
function enterOffRoute(){
  state.offRouteActive=true; state.offRouteElapsed=0; state.recoveryGlyph='offroute';
  setCondition('caution');
  offRouteBadStreak=0; offRouteGoodStreak=0;
  logEvent('off_route_entered', '');
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
    state.recoveryGlyph=offRouteStageForElapsed(state.offRouteElapsed);
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
function onFix(pos){
  const c=pos.coords, now=pos.timestamp;

  if(c.accuracy>BAD_ACCURACY_M){
    badFixStreak+=1;
    if(badFixStreak>4 && !state.gpsWeak){
      state.gpsWeak=true;
      logEvent('gps_weak_flagged', 'accuracy '+Math.round(c.accuracy)+'m for '+badFixStreak+' consecutive fixes',
        {lat:c.latitude, lng:c.longitude, accuracy:c.accuracy});
    }
    return;
  }
  badFixStreak=0;
  state.gpsWeak=false;

  let speedMps;
  if(typeof c.speed==='number' && !Number.isNaN(c.speed)){
    speedMps=c.speed;
  } else if(state.lastFix){
    const d=haversineMeters(state.lastFix.lat,state.lastFix.lng,c.latitude,c.longitude);
    const dtSec=(now-state.lastFix.t)/1000;
    speedMps = dtSec>0 ? d/dtSec : 0;
  } else {
    speedMps=0;
  }
  state.lastSpeedMps=speedMps;
  const dt = state.lastFix ? now-state.lastFix.t : 0;

  if(state.lastFix) updateDwell(speedMps, dt);
  checkOffRoute(c.latitude, c.longitude, dt);
  state.lastFix={lat:c.latitude,lng:c.longitude,t:now,accuracy:c.accuracy};

  if(!state.finished && state.context==='motion' && !state.confirmHold && !state.offRouteActive){
    advanceMotionProgress(c.accuracy);
  }

  render();
}
function onFixError(err){
  console.error('Geolocation error', err);
}

/* ============ RENDER DISPATCH ============
   Calls the unmodified renderMotion()/renderStationary() from render.js. */
let onEngineUpdate = null;
function setEngineUpdateHandler(fn){ onEngineUpdate=fn; }
function render(){
  if(state.context==='motion') renderMotion();
  else renderStationary();
  if(onEngineUpdate) onEngineUpdate(state);
}

/* ============ START / STOP ============ */
function startTest(route){
  stopTest();
  loadRoute(route);
  Object.assign(state,{
    context:'motion', condition:'normal', cue:ROUTE[0].cue, rot:ROUTE[0].rot||0,
    trueDist:ROUTE[0].dist, currentSeg:ROUTE[0].seg, jitter:false,
    confidenceFiring:false, confidenceVal:5, recoveryGlyph:'offroute',
    situation:'normal', drivingFromRoute:true, actionInverted:false, meterInverted:false, showFullMap:false,
    legIndex:0, distSoFar:0, stopDwell:0, moveDwell:0, confirmHold:false, finished:false,
    gpsWeak:false, lastFix:null, lastSpeedMps:null,
    offRouteActive:false, offRouteElapsed:0
  });
  badFixStreak=0; offRouteBadStreak=0; offRouteGoodStreak=0;
  render();
  watchId=navigator.geolocation.watchPosition(onFix, onFixError,
    {enableHighAccuracy:true, maximumAge:1000, timeout:5000});
}
function stopTest(){
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
