// 자유 매매 자동 설정 — 역방향 추가 진입 계획과 자동 익절가.
//  추가: 최초가에서 `step` 포인트 불리할 때마다 같은 수량, 최대 `maxAdds` 회.
//  손절: 마지막 추가 가격에서 `buffer` 포인트 더 + 손실 한도(잔고 %) — 실제 계산은 practice-broker.js autoStop().
//  익절: 평균가보다 이익인 자리 중 지금 가격에서 가장 먼저 닿는 곳.
//        3분봉 4·4 밴드(매수=위, 매도=아래)·3분봉 SMA120 은 직전에 완성된 3분봉 값, H1 매물대는 마지막 확정 H1 선택 구역.
//        매수는 저항 박스 아래쪽, 매도는 지지 박스 위쪽. 매 1분봉 시작마다 다시 계산한다(미래 봉은 보지 않는다).
import {upperBound} from './practice-data.js';
import {positionSummary} from './practice-broker.js';

export const AUTO_DEFAULTS=Object.freeze({grid:true,step:10,maxAdds:5,buffer:5,budgetPct:10,tp:true,band:true,ma:true,zone:true});
const finite=Number.isFinite;

export function checkGrid({step,maxAdds,buffer,budgetPct}){
 if(!(finite(step)&&step>0))throw Error('추가 간격은 0보다 큰 포인트로 입력해 주세요.');
 if(!(Number.isInteger(maxAdds)&&maxAdds>=1&&maxAdds<=20))throw Error('최대 추가 횟수는 1~20회로 입력해 주세요.');
 if(!(finite(buffer)&&buffer>=0))throw Error('손절 여유는 0 이상 포인트로 입력해 주세요.');
 if(!(finite(budgetPct)&&budgetPct>0&&budgetPct<=100))throw Error('손실 한도는 잔고의 0% 초과 100% 이하로 입력해 주세요.');
 return {step,maxAdds,buffer,budgetPct};
}

// 진입 가격 price 기준 추가 가격들과 '마지막 추가 + 여유' 손절가
export function gridPlan(dir,price,{step,maxAdds,buffer}){
 const adds=Array.from({length:maxAdds},(_,i)=>price-dir*step*(i+1));
 return {adds,stop:price-dir*(step*maxAdds+buffer),distance:step*maxAdds+buffer};
}

// time 시점(1분봉 시작)에 쓸 익절가. 없으면 null
export function autoTargetAt(market,position,time,sources={band:true,ma:true,zone:true},tick=.01){
 if(!position)return null;
 const d=position.dir,average=positionSummary(position).average,cands=[];
 const m3=market?.frames?.m3;
 if(m3?.length){
  const b=m3[upperBound(m3,time)-1];
  if(b){
   if(sources.band){const v=d===1?b.bb4Up:b.bb4Low;if(finite(v))cands.push({level:v,source:'3분 4·4 밴드'});}
   if(sources.ma&&finite(b.sma120))cands.push({level:b.sma120,source:'3분 SMA120'});
  }
 }
 if(sources.zone&&market?.zones?.length){
  const snap=market.zones[upperBound(market.zones,time)-1];
  for(const z of snap?.zones||[])if(z.res===(d===1))cands.push({level:d===1?z.bot:z.top,source:'H1 '+z.kind+(z.res?' 저항':' 지지')});
 }
 const ok=cands.filter(c=>d*(c.level-average)>=tick);
 if(!ok.length)return null;
 return ok.sort((x,y)=>d*(x.level-y.level))[0];
}
