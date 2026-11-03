/* MPL-2.0. Numerical port of the user's v16 H1 zone reconstruction.
 * Reference: backtest_9methods_zone_1-60_20261020/v16_engine.py.
 * Source states are retained; browser parity with TradingView is not asserted. */
import {indicators} from './practice-data.js';
const CANDIDATE=0,VALID=1,NEUTRAL=2,NONE=0,SUPPORT=1,RESISTANCE=2,BREAK=3,TICK=.01;
const finite=Number.isFinite;
export function zoneReady(z,p){return z.state===VALID&&z.hits>0&&!z.pending&&!z.waiting&&finite(p)&&(z.res?p<z.bot:p>z.top);}
const distance=(z,p)=>p>z.top?p-z.top:p<z.bot?z.bot-p:0;
function pairChoice(a,b,p){
 if(Math.min(a.top,b.top)<=Math.max(a.bot,b.bot)||a.family===2||b.family===2)return 0;
 const same=a.family===b.family,da=distance(a,p),db=distance(b,p);
 if(same||(da===0&&db===0)){if(b.born>a.born)return -1;if(a.born>b.born)return 1;if(!same||a.top!==b.top||a.bot!==b.bot||a.res!==b.res)return 2;return 0;}
 return db<da?-1:da<db?1:2;
}
export function selectZones(zones,p){return zones.filter((z,i)=>zoneReady(z,p)&&!zones.some((n,j)=>i!==j&&zoneReady(n,p)&&((j<i&&z.family===n.family&&z.kind===n.kind&&z.born===n.born&&z.top===n.top&&z.bot===n.bot&&z.res===n.res)||[-1,2].includes(pairChoice(z,n,p)))));}
export function rejection(z,b){return b.high>=z.bot&&b.low<=z.top&&(z.res?b.open<z.bot&&b.close<z.bot:b.open>z.top&&b.close>z.top);}
function firstAction(z,b){
 if(b.time<=z.last)return NONE;
 const touch=b.high>=z.bot&&b.low<=z.top;
 if(z.undecided||z.state===NEUTRAL){const sup=touch&&b.open>z.top&&b.close>=z.bot,res=touch&&b.open<z.bot&&b.close<=z.top;return res?RESISTANCE:sup?SUPPORT:NONE;}
 if(z.res?b.close>z.top:b.close<z.bot)return BREAK;
 return touch&&(z.res?b.open<z.bot:b.open>z.top)&&(z.state===CANDIDATE||!z.inside)?(z.res?RESISTANCE:SUPPORT):NONE;
}
export function calcBounds(b,avg){
 const range=b.high-b.low,bt=Math.max(b.open,b.close),bb=Math.min(b.open,b.close),up=b.high-bt,dn=bb-b.low,ok=finite(avg)&&avg>0;
 let top=b.high,bot=b.low;if(range>0&&up/range>=.5){top=b.high;bot=bt;}else if(range>0&&dn/range>=.5){top=bb;bot=b.low;}else if(ok&&range>2*avg){if(up>=dn){top=b.high;bot=bt;}else{top=bb;bot=b.low;}}
 const minimum=ok ? .25*avg : TICK*10;if(top-bot<minimum){const mid=(top+bot)/2;top=mid+minimum/2;bot=mid-minimum/2;}
 return {top,bot,valid:!ok||top-bot<=2*avg};
}
function fresh(high,b,pair){
 let top=high?b.high:Math.min(b.open,b.close),bot=high?Math.max(b.open,b.close):b.low,bounds=b.time,pending=!finite(b.avgRange)||top<=bot;
 if(finite(b.avgRange)&&top-bot>1.5*b.avgRange){pending=true;
  if(pair.length===2&&pair[0].time===b.time&&pair[1].time===b.time+1800&&Math.abs(pair[0].open-b.open)<=.0100001&&Math.abs(pair[1].close-b.close)<=.0100001&&Math.abs(Math.max(...pair.map(x=>x.high))-b.high)<=.0100001&&Math.abs(Math.min(...pair.map(x=>x.low))-b.low)<=.0100001){
   const choices=pair.filter(s=>Math.abs((high?s.high:s.low)-(high?b.high:b.low))<=.0100001).map(s=>({width:high?s.high-Math.max(s.open,s.close):Math.min(s.open,s.close)-s.low,time:s.time,edge:high?Math.max(s.open,s.close):Math.min(s.open,s.close)})).sort((a,b)=>a.width-b.width||a.time-b.time);
   const c=choices[0];if(c&&c.width>0&&bot<c.edge&&c.edge<top){if(high)bot=c.edge;else top=c.edge;bounds=c.time;pending=false;}
  }
 }
 return {top,bot,born:b.time,bounds,last:b.time,res:high,originRes:high,kind:high?'미국 최고':'미국 최저',state:CANDIDATE,hits:0,inside:false,live:true,pending,family:0,waiting:false,undecided:false,completed:b.time};
}
export function buildZoneTimeline(input,m30=[]){
 const bars=indicators(input),pairs=new Map();for(const b of m30){const t=Math.floor(b.time/3600)*3600;if(!pairs.has(t))pairs.set(t,[]);pairs.get(t).push(b);}
 let zones=[],highZone=null,lowZone=null,wasUS=false,sessionKey=null,sessionHi,sessionLo,runningHi=null,runningLo=null,completedHi=null,completedLo=null,sessionTimes=[];
 return bars.map((b,i)=>{
  const pair=pairs.get(b.time)||[],hour=new Date((b.time+32400)*1000).getUTCHours(),inUS=hour>=22||hour<5;
  if(inUS){const kstDay=Math.floor((b.time+32400)/86400)*86400-32400,key=kstDay+22*3600-(hour<22?86400:0);
   if(!wasUS||key!==sessionKey){if(highZone){highZone.live=lowZone.live=false;}highZone=fresh(true,b,pair);lowZone=fresh(false,b,pair);zones.push(highZone,lowZone);const v=calcBounds(b,b.avgRange);if(v.valid)zones.push({...fresh(false,b,pair),...v,kind:'미국 시가',live:false,family:2,undecided:true,pending:false});sessionHi=b.high;sessionLo=b.low;sessionKey=key;sessionTimes=[];runningHi=b.high;runningLo=b.low;}
   else{if(b.high>sessionHi){sessionHi=b.high;Object.assign(highZone,fresh(true,b,pair));}if(b.low<sessionLo){sessionLo=b.low;Object.assign(lowZone,fresh(false,b,pair));}runningHi=Math.max(runningHi,b.high);runningLo=Math.min(runningLo,b.low);}
   sessionTimes.push(b.time);
  }else if(wasUS){highZone.live=lowZone.live=false;if(sessionTimes.length===7&&sessionTimes.every((t,j)=>t===sessionKey+j*3600)){completedHi=runningHi;completedLo=runningLo;}}
  if(i>=3&&finite(b.avgRange)){
   const p=bars[i-1],p2=bars[i-2],p3=bars[i-3],trig=b.high-b.low>=.8*b.avgRange;
   const bull=trig&&p2.close>p2.open&&p.close<p.open&&b.close>b.open&&b.close>p.close,bear=trig&&p2.close<p2.open&&p.close>p.open&&b.close<b.open&&b.close<p.close;
   const bullExp=trig&&p3.close>p3.open&&p2.close<p2.open&&p.close<p.open&&b.close>b.open&&b.close>p.close&&!bull,bearExp=trig&&p3.close<p3.open&&p2.close>p2.open&&p.close>p.open&&b.close<b.open&&b.close<p.close&&!bear;
   for(const [res,trigger] of [[false,bull||bullExp],[true,bear||bearExp]])if(trigger&&!zones.some(z=>z.family===1&&z.born===p.time&&z.originRes===res)){const v=calcBounds(p,b.avgRange);if(v.valid)zones.push({...fresh(res,p,[]),...v,last:b.time,kind:'낚임',live:false,family:1,pending:false,strict:true,completed:b.time});}
  }
  const selectedBefore=selectZones(zones,i?bars[i-1].close:NaN);const broken=[];
  for(let j=zones.length-1;j>=0;j--){const z=zones[j];if(b.time-z.born>90*86400){zones.splice(j,1);continue;}if(z.pending)continue;
   let action=firstAction(z,b);
   if(z.state===NEUTRAL&&z.hits===0&&z.family===1&&[SUPPORT,RESISTANCE].includes(action)&&zones.some(n=>n.family===1&&n.born>z.born&&n.originRes!==z.originRes&&n.res===(action===RESISTANCE)&&n.state===CANDIDATE&&n.hits===0&&n.completed===b.time&&!n.pending&&!n.waiting&&Math.min(z.top,n.top)>=Math.max(z.bot,n.bot)))action=NONE;
   if(action===BREAK){if(selectedBefore.includes(z))broken.push({...z,dir:z.res?1:-1});z.state=NEUTRAL;z.last=b.time;z.inside=false;}
   else if(action===SUPPORT||action===RESISTANCE){z.state=VALID;z.undecided=false;z.res=action===RESISTANCE;z.hits++;z.last=b.time;z.inside=true;}
   else if(z.state===VALID)z.inside=b.high>=z.bot&&b.low<=z.top;
  }
  wasUS=inUS;
  const sessionCovered=inUS&&sessionTimes[0]===sessionKey;
  return {end:b.end??b.time+3600,zones:selectZones(zones,b.close).map(z=>({...z})),broken,usHi:inUS&&sessionCovered?runningHi:completedHi,usLo:inUS&&sessionCovered?runningLo:completedLo,previousUSHi:completedHi,previousUSLo:completedLo};
 });
}
