/* Shared route boundary: retain the recorded JSON format, distrust imported metadata. */
function validCoordinate(lat,lng){
  return Number.isFinite(lat) && Math.abs(lat)<=90 && Number.isFinite(lng) && Math.abs(lng)<=180;
}
function routeDistance(lat1,lng1,lat2,lng2){
  const rad=Math.PI/180, a=Math.sin((lat2-lat1)*rad/2)**2+
    Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin((lng2-lng1)*rad/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,a)));
}
const ROUTE_CUES = ['continue','bear','turn','sharp','keep','fork','merge','exit','roundabout','reverse','arrive'];
const ROUTE_SEGMENTS = ['protected','quiet','painted','mixed','unknown'];
const ROUTE_ROTATIONS = {continue:0,bear:-45,turn:-90,sharp:-135,keep:-90,fork:-45,merge:90,exit:90,roundabout:0,reverse:0,arrive:0};
function normalizeRoute(route){
  if(route && !Array.isArray(route)) return normalizeGeometryRoute(route);
  if(!Array.isArray(route) || route.length<2 || route.length>10000) throw new Error('Route needs 2–10000 waypoints.');
  return route.map((w,i)=>{
    if(!w || !validCoordinate(w.lat,w.lng)) throw new Error('Invalid coordinates at waypoint '+(i+1));
    if(!ROUTE_CUES.includes(w.cue) || !ROUTE_SEGMENTS.includes(w.seg)) throw new Error('Unknown cue or segment at waypoint '+(i+1));
    const dist=i ? routeDistance(route[i-1].lat,route[i-1].lng,w.lat,w.lng) : 0;
    if(i && dist<1) throw new Error('Adjacent waypoints must be at least 1m apart.');
    if(w.rot!=null && (!Number.isFinite(w.rot) || Math.abs(w.rot)>180)) throw new Error('Invalid rotation at waypoint '+(i+1));
    return {lat:w.lat,lng:w.lng,cue:w.cue,seg:w.seg,rot:w.rot??ROUTE_ROTATIONS[w.cue],
      land:typeof w.land==='string'?w.land.slice(0,500):'',distFromPrevious:dist};
  });
}
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Provider-neutral wire format. Coordinates always use GeoJSON [longitude, latitude]. */
function normalizeGeometryRoute(route){
  if(route.schemaVersion!==2 || !Array.isArray(route.geometry) || route.geometry.length<2 || route.geometry.length>100000){
    throw new Error('Version 2 routes need 2–100000 geometry coordinates.');
  }
  const geometry=route.geometry.map((p,i)=>{
    if(!Array.isArray(p) || p.length!==2 || !validCoordinate(p[1],p[0])) throw new Error('Invalid geometry coordinate '+i);
    if(i){
      const prev=route.geometry[i-1],distance=routeDistance(prev[1],prev[0],p[1],p[0]);
      if(distance<0.1 || distance>10000) throw new Error('Geometry edges must be 0.1m–10km long.');
    }
    return [...p];
  });
  if(!Array.isArray(route.maneuvers) || !route.maneuvers.length || route.maneuvers.length>10000) throw new Error('Route needs 1–10000 ordered maneuvers.');
  let previous=0;
  const maneuvers=route.maneuvers.map(m=>{
    if(!m || !Number.isInteger(m.geometryIndex) || m.geometryIndex<=previous || m.geometryIndex>=geometry.length) throw new Error('Maneuver indices must increase from 1 through the last geometry coordinate.');
    previous=m.geometryIndex;
    const cue=m.cue,seg=m.seg??'unknown',rot=m.rot??ROUTE_ROTATIONS[cue];
    if(!ROUTE_CUES.includes(cue) || !ROUTE_SEGMENTS.includes(seg) || !Number.isFinite(rot) || Math.abs(rot)>180) throw new Error('Invalid maneuver cue, segment or rotation.');
    if(m.exitNumber!=null && (!Number.isInteger(m.exitNumber) || m.exitNumber<1 || m.exitNumber>20)) throw new Error('Invalid roundabout exit number.');
    return {geometryIndex:m.geometryIndex,cue,seg,rot,land:typeof m.land==='string'?m.land.slice(0,500):'',
      instruction:typeof m.instruction==='string'?m.instruction.slice(0,500):'',exitNumber:m.exitNumber??null};
  });
  if(previous!==geometry.length-1) throw new Error('Final maneuver must reference the route endpoint.');
  if(maneuvers.slice(0,-1).some(m=>m.cue==='arrive')) throw new Error('Arrival is only valid at the endpoint.');
  if(route.revision!=null && (typeof route.revision!=='string' || route.revision.length>200)) throw new Error('Route revision must be a string of at most 200 characters.');
  return {schemaVersion:2,id:typeof route.id==='string'?route.id.slice(0,200):'imported-route',revision:route.revision??'1',
    geometry,maneuvers,source:route.source && typeof route.source==='object' ? {
      provider:typeof route.source.provider==='string'?route.source.provider.slice(0,200):'recorded',
      profile:typeof route.source.profile==='string'?route.source.profile.slice(0,200):'',
      attribution:typeof route.source.attribution==='string'?route.source.attribution.slice(0,1000):''
    } : {provider:'recorded',attribution:''}};
}
