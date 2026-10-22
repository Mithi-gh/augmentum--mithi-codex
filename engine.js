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
let routeModel = null;
let routeMatcher = null;
let latestMatch = null;
let recordedRoute = null;   // normalized geometry as named coordinates for legacy helpers

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
let offRouteEvidenceMs = 0;
let onRouteEvidenceMs = 0;
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
  const current=ROUTE[state.legIndex];
  if(!current) return 0;
  const start=state.legIndex ? ROUTE[state.legIndex-1].distance : 0;
  const end=!routeModel.legacy && ROUTE[state.legIndex+1] ? ROUTE[state.legIndex+1].distance : current.distance;
  const candidates=RouteGeometry.candidates(routeModel,[lng,lat],start,end);
  return candidates.length ? Math.min(...candidates.map(c=>c.distance)) : Infinity;
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
   Compile either legacy waypoints or version 2 full geometry. ROUTE remains the
   renderer's maneuver/leg view; distance is cumulative metres at the maneuver. */
function loadRoute(route){
  routeModel=RouteGeometry.compile(route);
  routeMatcher=new RouteMatcher(routeModel); latestMatch=null;
  recordedRoute=routeModel.geometry.map(([lng,lat])=>({lat,lng}));
  ROUTE=routeModel.maneuvers;
  TOTAL_ROUTE_DIST=routeModel.length;
}
function targetWaypoint(){
  return recordedRoute[ROUTE[state.legIndex].geometryIndex];
}
function applyMapMatch(continuous){
  const current=ROUTE[state.legIndex],next=ROUTE[state.legIndex+1];
  const limit=current.distance+(next?Math.min(30,next.dist/2):0);
  if(!continuous && routeMatcher.anchor) routeMatcher.interrupt();
  latestMatch=routeMatcher.update({...state.lastFix,speed:state.lastSpeedMps,heading:state.lastHeading},{limit});
  const previousStatus=state.matchStatus;
  state.matchStatus=latestMatch.status; state.matchedPosition=latestMatch.coordinate;
  state.progressAlongRoute=latestMatch.along; state.crossTrack=latestMatch.crossTrack;
  state.matchUncertain=!routeModel.legacy && !latestMatch.usable;
  if(previousStatus!==state.matchStatus) logEvent('match_status_changed',previousStatus+' -> '+state.matchStatus);
  if(!state.routeStarted && routeMatcher.anchor){state.routeStarted=true;logEvent('route_started','Start coordinate acquired');}
  if(!routeModel.legacy) state.trueDist=Math.max(0,current.distance-state.progressAlongRoute);
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
    state.finished=true; state.trueDist=0; state.cue='arrive'; state.progressAlongRoute=TOTAL_ROUTE_DIST;
    setCondition('confirm');
    logEvent('route_completed', 'All waypoints reached');
    stopTest();
    return;
  }
  state.cue=leg.cue; state.rot=leg.rot||0;
  const t=targetWaypoint();
  state.trueDist = !routeModel.legacy ? Math.max(0,leg.distance-state.progressAlongRoute) : state.lastFix ? haversineMeters(state.lastFix.lat,state.lastFix.lng,t.lat,t.lng) : leg.dist;
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
  if(!routeModel.legacy){
    if(!latestMatch?.usable) return false;
    const maneuver=ROUTE[state.legIndex];
    if(state.legIndex===ROUTE.length-1){
      const target=targetWaypoint();
      return state.trueDist<=waypointRadius() && haversineMeters(state.lastFix.lat,state.lastFix.lng,target.lat,target.lng)<=waypointRadius();
    }
    return state.progressAlongRoute>=maneuver.distance && state.progressAlongRoute<=maneuver.distance+30;
  }
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
function advanceGeometryProgress(){
  if(!state.routeStarted || !latestMatch?.usable) {waypointCandidateAt=null;return;}
  const leg=ROUTE[state.legIndex],final=state.legIndex===ROUTE.length-1;
  const remaining=leg.distance-state.progressAlongRoute;
  const target=targetWaypoint();
  const near=remaining>=-waypointRadius() && remaining<=waypointRadius();
  if(final){
    const rawDistance=haversineMeters(state.lastFix.lat,state.lastFix.lng,target.lat,target.lng);
    if(!near || rawDistance>waypointRadius() || state.lastFix.accuracy>10){waypointCandidateAt=null;return;}
    if(waypointCandidateAt===null)waypointCandidateAt=state.lastFix.t;
    if(state.lastFix.t-waypointCandidateAt>=1000)enterConfirmHold();
  }else if(leg.cue==='continue'){
    if(remaining<=0)advanceWaypoint();
  }else if(state.progressAlongRoute>=leg.distance+Math.min(3,ROUTE[state.legIndex+1].dist/3) &&
           latestMatch.segmentIndex>=leg.geometryIndex){
    enterConfirmHold();
  }
  if(!state.confirmHold && !state.finished)setCondition(leg.cue==='continue'?'normal':computeBand(state.trueDist,state.condition));
}
function advanceMotionProgress(){
  if(!routeModel.legacy){advanceGeometryProgress();return;}
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
   clear it. Version 2 uses the local reachable polyline and at least 2s of evidence;
   legacy recordings retain their original waypoint corridor behavior.
   Stay on the off-route message until actual recovery; no reroute is fabricated. */
function enterOffRoute(){
  cancelConfirmation(); previousProgressFix=null;
  state.offRouteActive=true; state.offRouteElapsed=0; state.recoveryGlyph='offroute';
  setCondition('caution');
  offRouteBadStreak=0; offRouteGoodStreak=0; offRouteEvidenceMs=0; onRouteEvidenceMs=0;
  logEvent('off_route_entered', '');
  const current=ROUTE[state.legIndex];
  if(current.cue!=='continue' && state.progressAlongRoute>=current.distance-25) logEvent('turn_missed','Possible missed maneuver; left the expected geometry corridor');
  else if(state.legIndex>0 && ROUTE[state.legIndex-1].cue!=='continue') logEvent('turn_missed','Possible missed turn; left the outgoing corridor');
}
function exitOffRoute(){
  state.offRouteActive=false; state.offRouteElapsed=0;
  offRouteBadStreak=0; offRouteGoodStreak=0; offRouteEvidenceMs=0; onRouteEvidenceMs=0;
  const leg=ROUTE[state.legIndex];
  setCondition((leg && leg.cue!=='continue') ? computeBand(state.trueDist,'normal') : 'normal');
  logEvent('off_route_cleared', '');
}
function checkOffRoute(lat,lng,dt){
  if(state.finished || !ROUTE[state.legIndex] || (!routeModel.legacy && !state.routeStarted)) return;
  const dist=routeModel.legacy ? perpendicularDistanceToLeg(lat,lng) : latestMatch.crossTrack??Infinity;
  if(state.offRouteActive){
    state.offRouteElapsed+=dt;

    if(dist<=OFF_ROUTE_CLEAR_M && (routeModel.legacy || latestMatch.usable)){
      offRouteGoodStreak+=1; onRouteEvidenceMs+=dt;
      if(offRouteGoodStreak>=OFF_ROUTE_CONSECUTIVE_FIXES && (routeModel.legacy || onRouteEvidenceMs>=2000)) exitOffRoute();
    } else {
      offRouteGoodStreak=0; onRouteEvidenceMs=0;
    }
  } else {
    if(dist-(routeModel.legacy?0:Math.min(state.lastFix.accuracy,10))>OFF_ROUTE_ENTER_M){
      offRouteBadStreak+=1; offRouteEvidenceMs+=dt;
      if(offRouteBadStreak>=OFF_ROUTE_CONSECUTIVE_FIXES && (routeModel.legacy || offRouteEvidenceMs>=2000)) enterOffRoute();
    } else {
      offRouteBadStreak=0; offRouteEvidenceMs=0;
    }
  }
}

/* ============ GEOLOCATION ============ */
function resetContinuity(){
  continuityBroken=true;
  if(routeMatcher)routeMatcher.interrupt();
  state.stopDwell=0; state.moveDwell=0;
  offRouteBadStreak=0; offRouteGoodStreak=0; offRouteEvidenceMs=0; onRouteEvidenceMs=0;
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
  if(!continuous && previous) resetContinuity();
  let speedMps=Number.isFinite(c.speed) && c.speed>=0 && c.speed<=MAX_SPEED_MPS ? c.speed : null;
  if(speedMps===null && continuous){
    speedMps=distance<=Math.max(previous.accuracy,c.accuracy) ? 0 : distance/(gap/1000);
  }
  state.lastFix={lat:c.latitude,lng:c.longitude,t:now,accuracy:c.accuracy};
  state.lastSpeedMps=speedMps;
  state.lastHeading=Number.isFinite(c.heading)?c.heading:null;
  continuityBroken=false;
  badFixStreak=0;
  if(state.gpsWeak){ state.gpsWeak=false; logEvent('gps_recovered','Reliable GPS resumed'); }
  armSignalTimeout();
  applyMapMatch(continuous);
  if(continuous && speedMps!==null) updateDwell(speedMps,gap);
  if(continuous) checkOffRoute(c.latitude,c.longitude,gap);
  if(state.routeStarted && routeModel.legacy){
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
   Keep the existing motion/stationary layout and surface GPS/matching uncertainty. */
let onEngineUpdate = null;
function setEngineUpdateHandler(fn){ onEngineUpdate=fn; }
function render(){
  if(state.context==='motion' && (state.gpsWeak || state.matchUncertain)) renderMotionOverlay();
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
    gpsWeak:false, lastFix:null, lastSpeedMps:null, lastHeading:null, routeStarted:false,
    progressAlongRoute:0, matchedPosition:null, crossTrack:null, matchStatus:'waiting',
    geometryAware:!routeModel.legacy, matchUncertain:false,
    offRouteActive:false, offRouteElapsed:0
  });
  badFixStreak=0; offRouteBadStreak=0; offRouteGoodStreak=0; offRouteEvidenceMs=0; onRouteEvidenceMs=0;
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
