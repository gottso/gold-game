/* Paper execution only. No order endpoint, broker account or real-money integration. */
const clone=v=>structuredClone(v),finite=Number.isFinite,EPS=1e-8,CONTRACT=100;
export function splitLots(total,parts=3,step=.01){const units=Math.floor((total+EPS)/step);if(units<parts)throw Error(`${parts}회 분할에 필요한 최소 수량이 부족합니다. 총 수량을 강제로 늘리지 않습니다.`);return Array.from({length:parts},(_,i)=>Math.round((Math.floor(units/parts)+(i<units%parts?1:0))*step*1e8)/1e8);}
const total=p=>p.entries.reduce((s,e)=>s+e.lots,0);
const avg=p=>p.entries.reduce((s,e)=>s+e.price*e.lots,0)/total(p);
export const positionSummary=p=>p?{lots:total(p),average:avg(p),entry0:p.entry0,stop:p.stop,target:p.target,count:p.entries.length}:null;
function exitQuote(p,mid,spread){return mid-p.dir*spread/2;}
export function unrealized(p,mid,spread=0){return p?(exitQuote(p,mid,spread)-avg(p))*p.dir*total(p)*CONTRACT:0;}
function makePosition(order,mid,spread,balance,time){
 const price=mid+order.dir*spread/2,p={dir:order.dir,entries:[{price,lots:order.planLots[0],time}],entry0:price,stop:order.stop,target:order.target,planLots:order.planLots,manage:order.manage,budget:balance*(order.budgetPct??10)/100,addLevels:order.addLevels||[],addExpires:order.expires??null,entryTime:time};
 if(p.manage==='grid'){p.stop=price-p.dir*55;p.addLevels=Array.from({length:5},(_,i)=>price-p.dir*10*(i+1));}
 if(p.manage==='benpark'){p.addLevels=[price-p.dir*10,price-p.dir*20];p.stop=avg(p)-p.dir*p.budget/(total(p)*CONTRACT);}
 return p;
}
function simulate(base,b,spread,path){
 const out=clone(base),events=[];let p=out.position,pending=out.pending;
 const close=(mid,reason,time)=>{const price=exitQuote(p,mid,spread),profit=(price-avg(p))*p.dir*total(p)*CONTRACT;out.balance+=profit;events.push({time,type:'close',reason,price,profit,lots:total(p),average:avg(p),entry0:p.entry0,entryTime:p.entryTime});p=null;pending=null;};
 const quote=(d,mid)=>mid+d*spread/2;
 function point(mid,opening=false){
  if(p){const price=exitQuote(p,mid,spread);if(p.dir*(price-p.stop)<=EPS){close(mid,opening?'갭 손절':'손절',b.time);return;}if(finite(p.target)&&p.dir*(price-p.target)>=-EPS){close(mid,opening?'갭 목표':'목표',b.time);return;}}
  if(pending&&pending.placedAt<=b.time&&(!finite(pending.limit)&&opening||finite(pending.limit)&&pending.dir*(quote(pending.dir,mid)-pending.limit)<=EPS)){
   const price=quote(pending.dir,mid);
   if(pending.manage!=='benpark'&&pending.manage!=='grid'&&pending.dir*(price-pending.stop)<=0||finite(pending.target)&&pending.dir*(pending.target-price)<=0){events.push({time:b.time,type:'cancel',reason:'갭으로 계획한 손절·목표 방향이 부적합해져 예약 취소'});pending=null;return;}
   p=makePosition(pending,mid,spread,out.balance,b.time);events.push({time:b.time,type:'entry',price,lots:p.entries[0].lots});pending=null;
  }
  if(p){let j=p.entries.length-1;while(j<p.addLevels.length&&p.entries.length<p.planLots.length&&p.dir*(quote(p.dir,mid)-p.addLevels[j])<=EPS){const price=quote(p.dir,mid),lots=p.planLots[p.entries.length];p.entries.push({price,lots,time:b.time});events.push({time:b.time,type:'add',price,lots});if(p.manage==='benpark')p.stop=avg(p)-p.dir*p.budget/(total(p)*CONTRACT);if(p.manage==='grid'&&(!finite(p.target)||p.dir*(p.target-p.entry0)>0))p.target=p.entry0;j=p.entries.length-1;}
   if(p.dir*(exitQuote(p,mid,spread)-p.stop)<=EPS)close(mid,'추가 후 합산 손절',b.time);
  }
 }
 if(pending&&finite(pending.expires)&&b.time>=pending.expires){events.push({time:b.time,type:'cancel',reason:'지정가 유효기간 종료'});pending=null;}
 if(p&&finite(p.addExpires)&&b.time>=p.addExpires)p.addLevels=[];
 point(b.open,true);
 const points=path==='OHLC'?[b.open,b.high,b.low,b.close]:[b.open,b.low,b.high,b.close];
 for(let i=1;i<points.length;i++){
  let a=points[i-1],end=points[i];for(let guard=0;guard<20;guard++){
   const levels=[];
   if(p){levels.push(p.stop+p.dir*spread/2);if(finite(p.target))levels.push(p.target+p.dir*spread/2);const add=p.addLevels[p.entries.length-1];if(finite(add)&&p.entries.length<p.planLots.length)levels.push(add-p.dir*spread/2);}
   if(pending&&finite(pending.limit))levels.push(pending.limit-pending.dir*spread/2);
   const next=levels.filter(v=>Math.abs(v-a)>EPS&&(end>=a?v>a&&v<=end:v<a&&v>=end)).sort((x,y)=>Math.abs(x-a)-Math.abs(y-a))[0];
   if(next===undefined)break;point(next);a=next;
  }
  point(end);
 }
 out.position=p;out.pending=pending;return {...out,events};
}
function comparable(s){return JSON.stringify({balance:s.balance,position:s.position,pending:s.pending,events:s.events});}
export class PaperBroker{
 constructor({balance=1000,spread=.4}={}){this.initial=balance;this.balance=balance;this.spread=spread;this.position=null;this.pending=null;this.ambiguity=null;this.journal=[];this.assumptions=0;}
 plan(order,time){
  if(this.balance<=0)throw Error('가상 잔고가 소진됐습니다. 이 모드에서 새 연습을 시작해 주세요.');
  if(this.position||this.pending||this.ambiguity)throw Error('현재 거래 묶음 또는 예약을 먼저 정리해 주세요.');
  if(![1,-1].includes(order.dir)||!Array.isArray(order.planLots)||!order.planLots.length||order.planLots.some(q=>!finite(q)||q<.01-EPS||Math.abs(q/.01-Math.round(q/.01))>EPS))throw Error('수량은 0.01랏 단위로 입력해 주세요.');
  if(!finite(order.stop)&&!['grid','benpark'].includes(order.manage))throw Error('진입 전에 실제 가격으로 손절 계획을 입력해 주세요.');
  if(finite(order.target)&&finite(order.stop)&&order.dir*(order.target-order.stop)<=0)throw Error('목표와 손절 가격 방향을 확인해 주세요.');
  this.pending={...clone(order),placedAt:time};this.journal.push({time,type:'plan',order:clone(this.pending)});
 }
 process(b){
  if(this.ambiguity)throw Error('모호한 봉의 체결 가정을 먼저 선택해 주세요.');
  if(this.pending&&this.pending.placedAt>b.time)return;
  if(!this.pending&&!this.position)return;
  const base={balance:this.balance,position:this.position,pending:this.pending},a=simulate(base,b,this.spread,'OHLC'),c=simulate(base,b,this.spread,'OLHC');
  if(comparable(a)!==comparable(c)){this.ambiguity={bar:clone(b),OHLC:a,OLHC:c};return;}
  this.apply(a);
 }
 apply(state,assumption=null){this.balance=state.balance;this.position=state.position;this.pending=state.pending;this.journal.push(...state.events.map(e=>({...e,...(assumption?{assumption}:{} )})));}
 resolve(path){if(!this.ambiguity||!['OHLC','OLHC'].includes(path))throw Error('체결 가정을 선택해 주세요.');const result=this.ambiguity[path];this.assumptions++;this.apply(result,path+' 가정 · 실제 순서 미확인');this.journal.push({time:this.ambiguity.bar.time,type:'assumption',path});this.ambiguity=null;}
 close(mid,time,reason='사용자 전량 청산'){
  if(this.ambiguity)throw Error('모호한 봉을 먼저 처리해 주세요.');
  this.pending=null;if(!this.position){this.journal.push({time,type:'cancel',reason:'예약 취소'});return;}
  const p=this.position,price=exitQuote(p,mid,this.spread),profit=unrealized(p,mid,this.spread);this.balance+=profit;this.journal.push({time,type:'close',reason,price,profit,lots:total(p),average:avg(p),entry0:p.entry0,entryTime:p.entryTime});this.position=null;
 }
 snapshot(){return {initial:this.initial,balance:this.balance,spread:this.spread,position:clone(this.position),pending:clone(this.pending),ambiguity:clone(this.ambiguity),journal:clone(this.journal),assumptions:this.assumptions};}
 static restore(s){const b=new PaperBroker();Object.assign(b,s);return b;}
}
