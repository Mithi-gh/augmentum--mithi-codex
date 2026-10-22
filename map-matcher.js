/* Stateful, ordered matching with conservative local reacquisition. No DOM, timers or logs. */
class RouteMatcher {
  constructor(model){
    this.model=model;
    this.anchor=null;
    this.raw=null;
    this.interrupted=false;
    this.reacquireCount=0;
    this.pendingCandidate=null;
  }
  interrupt(){this.interrupted=true;this.reacquireCount=0;this.pendingCandidate=null;}
  update(fix,{limit=Infinity}={}){
    const previous=this.raw;
    if(!fix || !validCoordinate(fix.lat,fix.lng) || !Number.isFinite(fix.t) || !Number.isFinite(fix.accuracy) || fix.accuracy<0 ||
       (previous && fix.t<=previous.t)){this.interrupt();return this.result('invalid');}
    const point=[fix.lng,fix.lat];
    if(fix.accuracy>=20){this.interrupt();return this.result('weak');}
    const dt=previous?(fix.t-previous.t)/1000:0;
    const displacement=previous?RouteGeometry.distance(point,[previous.lng,previous.lat]):0;
    if(previous && displacement>25*dt+previous.accuracy+fix.accuracy){this.interrupt();return this.result('invalid');}
    if(previous && dt>5)this.interrupt();
    const speed=Number.isFinite(fix.speed) && fix.speed>=0 && fix.speed<=25?fix.speed:null;
    this.raw={...fix};
    if(!this.anchor){
      const startRadius=Math.min(25,this.model.maneuvers[0].distance/2);
      if(RouteGeometry.distance(point,this.model.geometry[0])>startRadius)return this.result('waiting');
      this.anchor={along:0,segmentIndex:0,coordinate:[...this.model.geometry[0]],distance:0,bearing:this.model.segments[0].bearing};
      this.interrupted=false;
      return this.result('matched',0);
    }
    const reacquiring=this.interrupted;
    const stationary=speed!==null && speed<=0.5;
    const movement=previous && !reacquiring?displacement:0;
    const reach=reacquiring?30:Math.max(20,Math.min(100,movement*1.5+fix.accuracy*2));
    const min=Math.max(0,this.anchor.along-(reacquiring?30:Math.max(20,movement*1.5)));
    const max=Math.min(this.model.length,limit,this.anchor.along+reach);
    const candidates=RouteGeometry.candidates(this.model,point,min,max);
    if(!candidates.length){this.reacquireCount=0;return this.result(reacquiring?'lost':'unmatched',Infinity);}
    const crossTrack=Math.min(...candidates.map(c=>c.distance));
    let heading=null;
    if(!stationary && speed!==null && speed>=1 && Number.isFinite(fix.heading) && fix.heading>=0 && fix.heading<360)heading=fix.heading;
    else if(!stationary && previous && !reacquiring && displacement>Math.max(3,fix.accuracy))heading=RouteGeometry.bearing([previous.lng,previous.lat],point);
    const predicted=this.anchor.along+(stationary||reacquiring?0:Math.min(movement,25*Math.max(dt,0)));
    for(const c of candidates){
      const angle=heading===null?0:RouteGeometry.angleDifference(heading,c.bearing);
      // Reverse travel on the current path is valid; it must not select a future return leg.
      const reverse=c.along<this.anchor.along-2;
      const direction=heading===null?0:(reverse?Math.min(angle,180-angle):angle);
      c.score=c.distance+0.25*Math.abs(c.along-predicted)+direction/90*Math.max(5,fix.accuracy)+
        (Math.abs(c.segmentIndex-this.anchor.segmentIndex)>1?5:0);
    }
    candidates.sort((a,b)=>a.score-b.score);
    const best=candidates[0];
    if(best.distance>Math.max(15,fix.accuracy*1.5)){
      this.reacquireCount=0;return this.result(reacquiring?'lost':'unmatched',crossTrack);
    }
    const alternative=candidates.find(c=>Math.abs(c.along-best.along)>15 && Math.abs(c.segmentIndex-best.segmentIndex)>1 && c.distance<=fix.accuracy*1.5 && c.score-best.score<Math.max(3,fix.accuracy/2));
    if(alternative){this.reacquireCount=0;return this.result('ambiguous',crossTrack);}
    if(reacquiring){
      if(this.pendingCandidate && Math.abs(best.segmentIndex-this.pendingCandidate.segmentIndex)>1 && Math.abs(best.along-this.pendingCandidate.along)>10)this.reacquireCount=0;
      this.pendingCandidate=best;
      this.reacquireCount+=1;
      if(this.reacquireCount<3)return this.result('reacquiring',crossTrack);
      this.interrupted=false;this.reacquireCount=0;
    }
    if(!stationary)this.anchor=best;
    return this.result(stationary?'stationary':'matched',crossTrack);
  }
  result(status,crossTrack=null){
    return {status,along:this.anchor?.along??0,segmentIndex:this.anchor?.segmentIndex??0,
      coordinate:this.anchor?.coordinate??null,crossTrack,usable:status==='matched'||status==='stationary'};
  }
}
