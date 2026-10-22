/* ============ EVENT LOG ============
   This whole app exists to learn something from watching it run, so every
   state-meaningful transition gets a record — in memory immediately, and
   persisted to localStorage immediately after, so a crash or an accidental
   reload mid-ride doesn't lose the session.

   Runtime dependency, not a load-order one: logEvent() reads the current
   `state` (from engine.js) and CONF_LABEL_BY_N (from render.js) at CALL time,
   long after all three scripts have finished loading — so it doesn't matter
   which of engine.js / log.js loads first, only that both are present before
   any click or geolocation callback actually fires. */

const LOG_STORAGE_PREFIX = 'augmentumLog:';

let sessionLabel = null;
let sessionStartedAt = null;
let sessionEndedAt = null;
let logPersistenceError = null;
let logRecords = [];

function logStorageKey(){ return LOG_STORAGE_PREFIX+sessionLabel; }

function startSession(label){
  const base=label;
  let suffix=1;
  try{ while(localStorage.getItem(LOG_STORAGE_PREFIX+label)!==null) label=base+' ('+(++suffix)+')'; }catch(e){}
  sessionLabel = label;
  sessionEndedAt=null; logPersistenceError=null;
  sessionStartedAt = Date.now();
  logRecords = [];
  logEvent('session_started','',{lat:null,lng:null,accuracy:null,speedMps:null,condition:null,cue:null,segment:null});
}

function endSession(reason){
  if(sessionEndedAt!==null || sessionStartedAt===null) return;
  sessionEndedAt=Date.now();
  logEvent('session_ended',reason);
}

function persistLog(){
  if(!sessionLabel) return;
  try{ localStorage.setItem(logStorageKey(), JSON.stringify(logRecords)); logPersistenceError=null; }
  catch(e){ logPersistenceError=e.message; console.warn('[log] failed to persist log', e); }
}

/* overrides lets a caller supply lat/lng/accuracy/speedMps straight from a
   fix that was itself rejected (e.g. gps_weak_flagged fires on a fix bad
   enough that state.lastFix was never updated with it) rather than falling
   back to the last trusted position, which would misrepresent what actually
   happened at that moment. */
function logEvent(eventType, note, overrides){
  if(!sessionLabel) return null;
  const fix = (typeof state!=='undefined') ? state.lastFix : null;
  const o = overrides||{};
  const hasRoute=eventType!=='session_started' && typeof routeModel!=='undefined' && routeModel;
  const record = {
    label: sessionLabel,
    timestamp: Date.now(),
    lat: 'lat' in o ? o.lat : (fix ? fix.lat : null),
    lng: 'lng' in o ? o.lng : (fix ? fix.lng : null),
    accuracy: 'accuracy' in o ? o.accuracy : (fix ? fix.accuracy : null),
    speedMps: 'speedMps' in o ? o.speedMps : (typeof state!=='undefined' ? state.lastSpeedMps : null),
    condition: 'condition' in o ? o.condition : (typeof state!=='undefined' ? state.condition : null),
    cue: 'cue' in o ? o.cue : (typeof state!=='undefined' ? state.cue : null),
    segment: 'segment' in o ? o.segment : (typeof state!=='undefined' ? state.currentSeg : null),
    routeId: hasRoute ? routeModel.id : null,
    routeRevision: hasRoute ? routeModel.revision : null,
    progressMeters: hasRoute && typeof state!=='undefined' && Number.isFinite(state.progressAlongRoute) ? state.progressAlongRoute : null,
    matchStatus: hasRoute && typeof state!=='undefined' ? state.matchStatus??null : null,
    matchedSegment: hasRoute && typeof latestMatch!=='undefined' && latestMatch ? latestMatch.segmentIndex : null,
    event_type: eventType,
    note: note||''
  };
  logRecords.push(record);
  persistLog();
  return record;
}

function getLogRecords(){ return logRecords.slice(); }

function countEvents(eventType){
  return logRecords.reduce((n,r)=>n+(r.event_type===eventType?1:0), 0);
}

function buildSessionSummary(){
  return {
    label: sessionLabel,
    durationMs: sessionStartedAt!==null ? (sessionEndedAt??Date.now())-sessionStartedAt : 0,
    waypointsReached: countEvents('waypoint_reached'),
    offRouteCount: countEvents('off_route_entered'),
    stationaryCount: countEvents('stationary_entered'),
    recordCount: logRecords.length
  };
}

function logFileName(){
  return (sessionLabel||'augmentum-log').replace(/[^a-z0-9-_]+/gi,'-')+'.json';
}

function downloadLog(){
  const blob=new Blob([JSON.stringify(logRecords,null,2)], {type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=logFileName();
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* Web Share API — file downloads behave inconsistently in mobile Safari,
   this is the alternate path where it's available. Never assumed available:
   callers should check navigator.share themselves before showing the button. */
async function shareLog(){
  if(!navigator.share) return {shared:false, reason:'Web Share API not available in this browser'};
  const file=new File([JSON.stringify(logRecords,null,2)], logFileName(), {type:'application/json'});
  try{
    if(navigator.canShare && !navigator.canShare({files:[file]})){
      return {shared:false, reason:'this browser cannot share files via Web Share'};
    }
    await navigator.share({files:[file], title:'Augmentum ride log', text:sessionLabel||''});
    return {shared:true};
  }catch(e){
    if(e.name==='AbortError') return {shared:false, reason:'cancelled'};
    return {shared:false, reason:e.message};
  }
}
