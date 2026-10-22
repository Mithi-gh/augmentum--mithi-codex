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
let preflightTimer = null;
let preflightGeneration = 0;
let reliabilityGeneration = 0;
let viewportBeforeRide = null;
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

/* ---- location gates Start; wake lock is reported as optional capability ---- */
function preflightAllGreen(){
  return preflightState.locationGranted &&
    preflightState.gpsAccuracy!=null && preflightState.gpsAccuracy<PREFLIGHT_GPS_OK_M;
}
function emitPreflightUpdate(){
  if(preflightOnUpdate) preflightOnUpdate(Object.assign({}, preflightState, {allGreen:preflightAllGreen()}));
}
function onPreflightFix(pos){
  if(!pos || !pos.coords || !Number.isFinite(pos.timestamp) || Date.now()-pos.timestamp>5000 || pos.timestamp>Date.now()+1000 ||
    !Number.isFinite(pos.coords.latitude) || Math.abs(pos.coords.latitude)>90 ||
    !Number.isFinite(pos.coords.longitude) || Math.abs(pos.coords.longitude)>180 ||
    !Number.isFinite(pos.coords.accuracy) || pos.coords.accuracy<0){
      preflightState.gpsAccuracy=null; emitPreflightUpdate(); return;
  }
  clearTimeout(preflightTimer);
  preflightTimer=setTimeout(()=>{ preflightState.gpsAccuracy=null; emitPreflightUpdate(); },5000);
  preflightState.locationGranted=true;
  preflightState.gpsAccuracy=pos.coords.accuracy;
  emitPreflightUpdate();
}
function onPreflightFixError(err){
  clearTimeout(preflightTimer);
  preflightState.gpsAccuracy=null;
  if(err.code===1) preflightState.locationGranted=false;
  emitPreflightUpdate();
}
function startPreflightChecks(onUpdate){
  stopPreflightChecks();
  const generation=++preflightGeneration;
  preflightState.locationGranted=false; preflightState.gpsAccuracy=null;
  preflightOnUpdate=onUpdate;
  emitPreflightUpdate();
  if(!('geolocation' in navigator)) return;
  preflightWatchId=navigator.geolocation.watchPosition(
    pos=>{if(generation===preflightGeneration) onPreflightFix(pos);},
    err=>{if(generation===preflightGeneration) onPreflightFixError(err);},
    {enableHighAccuracy:true, maximumAge:1000, timeout:5000});
}
function stopPreflightChecks(){
  preflightGeneration+=1; clearTimeout(preflightTimer);
  if(preflightWatchId!=null){ navigator.geolocation.clearWatch(preflightWatchId); preflightWatchId=null; }
}

/* ---- viewport: block pinch-zoom and double-tap-zoom ---- */
function lockViewportZoom(){
  let meta=document.querySelector('meta[name="viewport"]');
  if(!meta){ meta=document.createElement('meta'); meta.name='viewport'; document.head.appendChild(meta); }
  if(viewportBeforeRide===null) viewportBeforeRide={content:meta.getAttribute('content'),touchAction:document.documentElement.style.touchAction};
  meta.setAttribute('content','width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no');
  document.documentElement.style.touchAction='manipulation'; // the viewport meta alone doesn't stop double-tap zoom
}

/* ---- wake lock, reacquired whenever the tab returns to foreground ---- */
async function requestWakeLock(){
  if(!('wakeLock' in navigator)){ deviceStatus.wakeLock=false; emitDeviceStatus(); return; }
  const generation=reliabilityGeneration;
  if(!rideDeviceReliabilityActive || wakeLock) return;
  try{
    const acquired=await navigator.wakeLock.request('screen');
    if(!rideDeviceReliabilityActive || generation!==reliabilityGeneration){ await acquired.release(); return; }
    if(wakeLock){ await acquired.release(); return; }
    wakeLock=acquired;
    deviceStatus.wakeLock=true; emitDeviceStatus();
    acquired.addEventListener('release', ()=>{ if(wakeLock===acquired){ wakeLock=null; deviceStatus.wakeLock=false; emitDeviceStatus(); } });
  }catch(e){
    if(generation===reliabilityGeneration){ deviceStatus.wakeLock=false; emitDeviceStatus(); }
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
  const generation=reliabilityGeneration;
  try{
    await req.call(target);
    if(!rideDeviceReliabilityActive || generation!==reliabilityGeneration){
      if(document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      return;
    }
    lockOrientationBestEffort();
  }
  catch(e){
    console.warn('[preflight] fullscreen request failed',e);
    if(rideDeviceReliabilityActive && generation===reliabilityGeneration) lockOrientationBestEffort();
  }
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
  const generation=reliabilityGeneration;
  try{
    if(!screen.orientation || typeof screen.orientation.lock!=='function'){
      deviceStatus.orientationLock=false; emitDeviceStatus();
      return;
    }
    const result=screen.orientation.lock('portrait');
    if(result && typeof result.then==='function'){
      result.then(
        ()=>{ if(rideDeviceReliabilityActive && generation===reliabilityGeneration){deviceStatus.orientationLock=true; emitDeviceStatus();} else if(screen.orientation.unlock) screen.orientation.unlock(); },
        ()=>{ if(generation===reliabilityGeneration){deviceStatus.orientationLock=false; emitDeviceStatus();} } // rejected: not supported here, needs fullscreen first, or any other reason
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
  rideDeviceReliabilityActive=true; reliabilityGeneration+=1;
  requestFullscreenBestEffort(fullscreenEl);
  lockViewportZoom();
  requestWakeLock();
  armWakeLockReacquire();
  // Orientation is attempted after fullscreen settles, or immediately when unsupported.
  if(!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) lockOrientationBestEffort();
}
function disarmDeviceReliability(){
  rideDeviceReliabilityActive=false; reliabilityGeneration+=1;
  if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(()=>{});
  try{if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock();}catch(e){}
  deviceStatus.orientationLock=false; deviceStatus.wakeLock=false; emitDeviceStatus();
  if(viewportBeforeRide){
    const meta=document.querySelector('meta[name="viewport"]');
    meta.setAttribute('content',viewportBeforeRide.content);
    document.documentElement.style.touchAction=viewportBeforeRide.touchAction; viewportBeforeRide=null;
  }
  if(wakeLock){ wakeLock.release().catch(()=>{}); wakeLock=null; }
}
