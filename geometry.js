/* UI-independent polyline math. Requires route.js; all distances are metres. */
const RouteGeometry=(()=>{
  const R=6371000, RAD=Math.PI/180;
  const longitudeDelta=d=>((d+540)%360)-180;
  function xy(point,origin){
    return {x:longitudeDelta(point[0]-origin[0])*RAD*R*Math.cos((point[1]+origin[1])*RAD/2),
      y:(point[1]-origin[1])*RAD*R};
  }
  function compile(input){
    const route=normalizeRoute(input),legacy=Array.isArray(route);
    const geometry=legacy ? route.map(w=>[w.lng,w.lat]) : route.geometry;
    const cumulative=[0],segments=[];
    for(let i=1;i<geometry.length;i++){
      const a=geometry[i-1],b=geometry[i],length=routeDistance(a[1],a[0],b[1],b[0]);
      const vector=xy(b,a);
      segments.push({index:i-1,a,b,length,start:cumulative[i-1],end:cumulative[i-1]+length,
        bearing:(Math.atan2(vector.x,vector.y)/RAD+360)%360});
      cumulative.push(cumulative[i-1]+length);
    }
    const raw=legacy ? route.slice(1).map((w,i)=>({...w,geometryIndex:i+1})) : route.maneuvers;
    let previous=0;
    const maneuvers=raw.map(m=>{
      const distance=cumulative[m.geometryIndex],dist=distance-previous;previous=distance;
      return {...m,distance,dist};
    });
    return {id:legacy?'legacy-recording':route.id,revision:legacy?'1':route.revision,legacy,geometry,cumulative,segments,maneuvers,
      length:cumulative.at(-1),source:legacy?{provider:'recorded'}:route.source};
  }
  function project(point,segment,minAlong=segment.start,maxAlong=segment.end){
    const p=xy(point,segment.a),v=xy(segment.b,segment.a),lengthSquared=v.x*v.x+v.y*v.y;
    const minimum=Math.max(0,(minAlong-segment.start)/segment.length);
    const maximum=Math.min(1,(maxAlong-segment.start)/segment.length);
    const fraction=Math.max(minimum,Math.min(maximum,(p.x*v.x+p.y*v.y)/lengthSquared));
    return {segmentIndex:segment.index,fraction,distance:Math.hypot(p.x-v.x*fraction,p.y-v.y*fraction),
      along:segment.start+fraction*segment.length,bearing:segment.bearing,
      coordinate:[((segment.a[0]+longitudeDelta(segment.b[0]-segment.a[0])*fraction+540)%360)-180,
        segment.a[1]+(segment.b[1]-segment.a[1])*fraction]};
  }
  function candidates(model,point,minAlong,maxAlong){
    // Binary search avoids scanning an entire touring route for each GPS update.
    let low=0,high=model.segments.length;
    while(low<high){const mid=(low+high)>>1;if(model.segments[mid].end<minAlong)low=mid+1;else high=mid;}
    const result=[];
    for(let i=low;i<model.segments.length && model.segments[i].start<=maxAlong;i++){
      const candidate=project(point,model.segments[i],minAlong,maxAlong);
      if(candidate.along>=minAlong-0.01 && candidate.along<=maxAlong+0.01)result.push(candidate);
    }
    return result;
  }
  function distance(point,a){return routeDistance(point[1],point[0],a[1],a[0]);}
  function bearing(a,b){const v=xy(b,a);return (Math.atan2(v.x,v.y)/RAD+360)%360;}
  function angleDifference(a,b){return Math.abs(((a-b+540)%360)-180);}
  return Object.freeze({compile,project,candidates,distance,bearing,angleDifference});
})();
