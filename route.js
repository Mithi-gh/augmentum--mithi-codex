/* Shared route boundary: retain the recorded JSON format, distrust imported metadata. */
function validCoordinate(lat,lng){
  return Number.isFinite(lat) && Math.abs(lat)<=90 && Number.isFinite(lng) && Math.abs(lng)<=180;
}
function routeDistance(lat1,lng1,lat2,lng2){
  const rad=Math.PI/180, a=Math.sin((lat2-lat1)*rad/2)**2+
    Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin((lng2-lng1)*rad/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,a)));
}
function normalizeRoute(route){
  if(!Array.isArray(route) || route.length<2 || route.length>10000) throw new Error('Route needs 2–10000 waypoints.');
  return route.map((w,i)=>{
    if(!w || !validCoordinate(w.lat,w.lng)) throw new Error('Invalid coordinates at waypoint '+(i+1));
    if(!Object.hasOwn(CUE_LABEL,w.cue) || !Object.hasOwn(SEG_LABEL,w.seg)) throw new Error('Unknown cue or segment at waypoint '+(i+1));
    const dist=i ? routeDistance(route[i-1].lat,route[i-1].lng,w.lat,w.lng) : 0;
    if(i && dist<1) throw new Error('Adjacent waypoints must be at least 1m apart.');
    if(w.rot!=null && (!Number.isFinite(w.rot) || Math.abs(w.rot)>180)) throw new Error('Invalid rotation at waypoint '+(i+1));
    return {lat:w.lat,lng:w.lng,cue:w.cue,seg:w.seg,rot:w.rot??CUE_ROT[w.cue],
      land:typeof w.land==='string'?w.land.slice(0,500):'',distFromPrevious:dist};
  });
}
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
