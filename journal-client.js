// 개인 백테스트 기록 — 청산될 때마다 기기에 먼저 쌓고(인터넷이 끊겨도 보존) 기록 코드가 있으면 서버로 보낸다.
// 서버 함수 journal 은 기록 코드(x-journal-code)가 맞을 때만 읽고 쓴다. 코드는 이 기기 localStorage 에만 둔다.
import {SB_URL,SB_H} from './gold-config.js';

export const JOURNAL_FN=SB_URL+'/functions/v1/journal';
const K={code:'gold_journal_code',queue:'gold_journal_queue',sent:'gold_journal_sent'};
const store={
 get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch{return d;}},
 set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}}
};
const round=(v,n=2)=>Number.isFinite(v)?Math.round(v*10**n)/10**n:null;

export function getCode(){try{return localStorage.getItem(K.code)||'';}catch{return '';}}
export function setCode(code){try{code?localStorage.setItem(K.code,code):localStorage.removeItem(K.code);}catch{}}
export const pendingCount=()=>store.get(K.queue,[]).length;

// 같은 기록(client_id)은 한 번만 대기열에 넣는다
export function enqueue(trades){
 const queue=store.get(K.queue,[]),sent=new Set(store.get(K.sent,[])),have=new Set(queue.map(t=>t.client_id));let added=0;
 for(const t of trades||[]){if(!t?.client_id||sent.has(t.client_id)||have.has(t.client_id))continue;queue.push(t);have.add(t.client_id);added++;}
 if(added)store.set(K.queue,queue);
 return added;
}

let flushing=null;
export function flush({fetcher=fetch}={}){
 if(flushing)return flushing;
 flushing=(async()=>{
  const code=getCode();let queue=store.get(K.queue,[]);
  if(!code)return {sent:0,left:queue.length,reason:'no-code'};
  let sent=0;
  while(queue.length){
   const batch=queue.slice(0,200),ids=new Set(batch.map(t=>t.client_id));
   const r=await fetcher(JOURNAL_FN+'?op=trades',{method:'POST',headers:{...SB_H,'x-journal-code':code,'Content-Type':'application/json'},body:JSON.stringify({trades:batch})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||('기록 전송 실패 (HTTP '+r.status+')'));
   // 서버가 형식 오류로 거른 행도 대기열에서 빼서 영원히 막히지 않게 한다
   store.set(K.sent,[...store.get(K.sent,[]),...ids].slice(-5000));
   queue=store.get(K.queue,[]).filter(t=>!ids.has(t.client_id));store.set(K.queue,queue);
   sent+=(d.accepted||[]).length;
  }
  return {sent,left:0};
 })().finally(()=>{flushing=null;});
 return flushing;
}

async function call(op,{method='GET',params={},code=getCode(),fetcher=fetch}={}){
 if(!code)throw Error('기록 코드를 먼저 설정해 주세요.');
 const r=await fetcher(JOURNAL_FN+'?'+new URLSearchParams({op,...params}),{method,headers:{...SB_H,'x-journal-code':code}});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.error||('HTTP '+r.status));
 return d;
}
export const ping=code=>call('ping',{code});
export const listTrades=(params={})=>call('trades',{params}).then(d=>d.trades||[]);
export const deleteTrade=id=>call('trades',{method:'DELETE',params:{id}});
export const listBoxes=(symbol='XAUUSD')=>call('boxes',{params:{symbol}}).then(d=>d.boxes||[]);

// ---- 기록 만들기 ----
// 11종 연습: 체결 엔진 기록(plan→entry→add…→close)에서 청산 묶음마다 한 건
export function practiceTrades(journal,{runId,mode,modeLabel,dataset,stepTf,stepSec,lesson,variant}){
 const out=[];let plan=null,entry=null,adds=0,assumption=null;
 (journal||[]).forEach((e,i)=>{
  if(e.type==='plan'){plan=e.order||null;entry=null;adds=0;assumption=null;return;}
  if(e.assumption)assumption=e.assumption;
  if(e.type==='entry'){entry=e;return;}
  if(e.type==='add'){adds++;return;}
  if(e.type!=='close'||!plan||![1,-1].includes(plan.dir))return;
  const stop=Number.isFinite(plan.stop)?plan.stop:null,firstLots=entry?.lots??plan.planLots?.[0],risk=stop!=null&&Number.isFinite(e.entry0)&&firstLots?Math.abs(e.entry0-stop)*firstLots*100:null;
  out.push({client_id:`p:${runId}:${i}`,source:'practice',mode:String(mode),mode_label:modeLabel,dataset,run_id:runId,dir:plan.dir,lots:e.lots,
   entry_time:e.entryTime,entry_price:round(e.entry0,3),exit_time:e.time,exit_price:round(e.price,3),exit_reason:e.reason,
   stop,target:Number.isFinite(plan.target)?plan.target:null,pnl:round(e.profit),r_multiple:risk>0?round(e.profit/risk):null,
   bars_held:stepSec&&Number.isFinite(e.entryTime)?Math.max(0,Math.round((e.time-e.entryTime)/stepSec)):null,adds,assumption:e.assumption||assumption,
   meta:{average:round(e.average,3),stepTf,lesson,variant,manage:plan.manage||null}});
  plan=null;entry=null;adds=0;assumption=null;
 });
 return out;
}
// 자유 게임: 포지션 하나가 청산될 때 한 건 (손절 개념이 없어 R 없음)
export function freeTrade(p,{runId,exitPrice,entryTime,exitTime,reason,barsHeld,dataset,meta={}}){
 return {client_id:`f:${runId}:${p.id}`,source:'free',mode:'free',mode_label:'자유 게임',dataset,run_id:runId,dir:p.dir,lots:p.lots,
  entry_time:entryTime,entry_price:round(p.entry,3),exit_time:exitTime,exit_price:round(exitPrice,3),exit_reason:reason,
  stop:null,target:null,pnl:round((exitPrice-p.entry)*p.dir*p.lots*100),r_multiple:null,bars_held:barsHeld,adds:0,assumption:null,meta};
}

// ---- 통계 ----
export function summarize(trades){
 const list=[...(trades||[])].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.exit_time).localeCompare(String(b.exit_time)));
 const n=list.length,pnl=list.map(t=>+t.pnl||0),wins=pnl.filter(v=>v>0),losses=pnl.filter(v=>v<0);
 const sumW=wins.reduce((s,v)=>s+v,0),sumL=losses.reduce((s,v)=>s+v,0),rs=list.map(t=>t.r_multiple).filter(v=>v!=null&&Number.isFinite(+v)).map(Number);
 let eq=0,peak=0,dd=0,streak=0,worst=0;
 for(const v of pnl){eq+=v;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);if(v<0){streak++;worst=Math.max(worst,streak);}else streak=0;}
 return {count:n,wins:wins.length,losses:losses.length,winRate:n?wins.length/n:null,total:round(eq),average:n?round(eq/n):null,
  avgWin:wins.length?round(sumW/wins.length):null,avgLoss:losses.length?round(sumL/losses.length):null,
  profitFactor:losses.length?round(sumW/Math.abs(sumL)):(wins.length?Infinity:null),
  rCount:rs.length,avgR:rs.length?round(rs.reduce((s,v)=>s+v,0)/rs.length):null,maxDrawdown:round(dd),maxLosingStreak:worst};
}
export function groupByMode(trades){
 const m=new Map();for(const t of trades||[]){const k=t.source==='free'?'free':String(t.mode);if(!m.has(k))m.set(k,{key:k,label:t.mode_label||k,trades:[]});m.get(k).trades.push(t);}
 return [...m.values()].map(g=>({...g,stats:summarize(g.trades)}));
}
