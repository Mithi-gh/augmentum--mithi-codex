/* ============ PRE-FLIGHT DEVICE RELIABILITY ============
   Everything a phone browser tab needs to survive being propped on a
   handlebar for an actual ride: a screen wake lock (releases the instant
   the tab is backgrounded, even briefly, so it must be reacquired),
   fullscreen, pinch/double-tap zoom blocked, and a best-effort portrait
   lock. All four are armed together from the Start button's own click
   handler, since that's the one guaranteed user-gesture moment fullscreen
   and wake lock need in order to succeed reliably.

   The three pre-flight checks run against their own ambient watchPosition,
   independent of the ride-tracking watch engine.js opens on Start — this
   module knows nothing about engine.js and can be dropped into any page. */

const PREFLIGHT_GPS_OK_M = 20;

let preflightWatchId = null;
let preflightOnUpdate = null;
const preflightState = { locationGranted:false, wakeLockAvailable:('wakeLock' in navigator), gpsAccuracy:null };

let wakeLock = null;
let wakeLockReacquireArmed = false;
let rideDeviceReliabilityActive = false;

/* ---- live on/off status for the three unreliable browser features ----
   Separate from the pre-flight gate: this doesn't block anything, it just
   reports what actually engaged on this specific device, since all three
   are known to behave inconsistently across desktop/Android Chrome/iOS
   Safari and a researcher in the field has no devtools to check otherwise. */
let onDeviceStatusUpdate = null;
const deviceStatus = { fullscreen:false, orientationLock:false, wakeLock:false };
function emitDeviceStatus(){ if(onDeviceStatusUpdate) onDeviceStatusUpdate(Object.assign({}, deviceStatus)); }
function setDeviceStatusHandler(fn){ onDeviceStatusUpdate=fn; emitDeviceStatus(); }
document.addEventListener('fullscreenchange', ()=>{
  deviceStatus.fullscreen=!!document.fullscreenElement;
  emitDeviceStatus();
});

/* ---- the three gating checks ---- */
function preflightAllGreen(){
  return preflightState.locationGranted && preflightState.wakeLockAvailable &&
    preflightState.gpsAccuracy!=null && preflightState.gpsAccuracy<PREFLIGHT_GPS_OK_M;
}
function emitPreflightUpdate(){
  if(preflightOnUpdate) preflightOnUpdate(Object.assign({}, preflightState, {allGreen:preflightAllGreen()}));
}
function onPreflightFix(pos){
  preflightState.locationGranted=true;
  preflightState.gpsAccuracy=pos.coords.accuracy;
  emitPreflightUpdate();
}
function onPreflightFixError(err){
  if(err.code===err.PERMISSION_DENIED){ preflightState.locationGranted=false; preflightState.gpsAccuracy=null; }
  emitPreflightUpdate();
}
function startPreflightChecks(onUpdate){
  preflightOnUpdate=onUpdate;
  emitPreflightUpdate();
  if(!('geolocation' in navigator)) return;
  preflightWatchId=navigator.geolocation.watchPosition(onPreflightFix, onPreflightFixError,
    {enableHighAccuracy:true, maximumAge:1000, timeout:5000});
}
function stopPreflightChecks(){
  if(preflightWatchId!=null){ navigator.geolocation.clearWatch(preflightWatchId); preflightWatchId=null; }
}

/* ---- viewport: block pinch-zoom and double-tap-zoom ---- */
function lockViewportZoom(){
  let meta=document.querySelector('meta[name="viewport"]');
  if(!meta){ meta=document.createElement('meta'); meta.name='viewport'; document.head.appendChild(meta); }
  meta.setAttribute('content','width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no');
  document.documentElement.style.touchAction='manipulation'; // the viewport meta alone doesn't stop double-tap zoom
}

/* ---- wake lock, reacquired whenever the tab returns to foreground ---- */
async function requestWakeLock(){
  if(!('wakeLock' in navigator)){ deviceStatus.wakeLock=false; emitDeviceStatus(); return; }
  try{
    wakeLock=await navigator.wakeLock.request('screen');
    deviceStatus.wakeLock=true; emitDeviceStatus();
    wakeLock.addEventListener('release', ()=>{ wakeLock=null; deviceStatus.wakeLock=false; emitDeviceStatus(); });
  }catch(e){
    deviceStatus.wakeLock=false; emitDeviceStatus();
    console.warn('[preflight] wake lock request failed', e);
  }
}
function armWakeLockReacquire(){
  if(wakeLockReacquireArmed) return;
  wakeLockReacquireArmed=true;
  document.addEventListener('visibilitychange', ()=>{
    if(rideDeviceReliabilityActive && document.visibilityState==='visible' && wakeLock===null){
      requestWakeLock();
    }
  });
}

/* ---- fullscreen, best effort ---- */
async function requestFullscreenBestEffort(el){
  const target=el||document.documentElement;
  const req=target.requestFullscreen||target.webkitRequestFullscreen;
  if(!req) return;
  try{ await req.call(target); }
  catch(e){ console.warn('[preflight] fullscreen request failed', e); }
}

/* ---- orientation lock, best effort ----
   Must survive: the API not existing at all (iOS Safari, never throws — just
   absent), the API existing but rejecting because fullscreen isn't active yet
   (a real Android Chrome failure mode, plausible here since fullscreen can
   itself fail), a synchronous throw from the call site itself, or any other
   rejection reason. None of these may escape as an uncaught error, alert the
   user, or block Start — and this never assumes fullscreen succeeded first,
   it just attempts the lock regardless and reports whatever actually happened. */
function lockOrientationBestEffort(){
  try{
    if(!screen.orientation || typeof screen.orientation.lock!=='function'){
      deviceStatus.orientationLock=false; emitDeviceStatus();
      return;
    }
    const result=screen.orientation.lock('portrait');
    if(result && typeof result.then==='function'){
      result.then(
        ()=>{ deviceStatus.orientationLock=true; emitDeviceStatus(); },
        ()=>{ deviceStatus.orientationLock=false; emitDeviceStatus(); } // rejected: not supported here, needs fullscreen first, or any other reason
      );
    } else {
      deviceStatus.orientationLock=false; emitDeviceStatus();
    }
  }catch(e){
    deviceStatus.orientationLock=false; emitDeviceStatus();
  }
}

/* ---- call once, from the Start button's own click handler ----
   requestFullscreenBestEffort fires FIRST and synchronously: the Fullscreen
   API only grants the request inside the browser's transient user-activation
   window from the click, and anything awaited ahead of it (even calling an
   async function like requestWakeLock, which suspends at its own internal
   await) risks that window closing before the fullscreen call is reached. */
function armDeviceReliability(fullscreenEl){
  rideDeviceReliabilityActive=true;
  requestFullscreenBestEffort(fullscreenEl);
  lockViewportZoom();
  requestWakeLock();
  armWakeLockReacquire();
  lockOrientationBestEffort();
}
function disarmDeviceReliability(){
  rideDeviceReliabilityActive=false;
  if(wakeLock){ wakeLock.release().catch(()=>{}); wakeLock=null; }
}
