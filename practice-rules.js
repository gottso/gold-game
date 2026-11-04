import {TF,indicators,aggregate,upperBound} from './practice-data.js';
import {buildZoneTimeline,rejection} from './practice-zones.js';
export const MODES=[
 {id:'1',name:'매물대 쌍비 변곡',tf:'m5',summary:'H1 유효 매물대와 3~8봉 간격의 새 밴드 접촉을 함께 봅니다.'},
 {id:'2',name:'추세지속 기본비 눌림',tf:'m5',summary:'20·60·120 배열 방향으로 새 반대쪽 밴드 접촉을 기다립니다.'},
 {id:'3',name:'20·120 교차 첫 장기이평',tf:'m5',summary:'교차봉을 제외한 첫 SMA120 접촉과 배열 방향의 종가를 확인합니다.'},
 {id:'4',name:'매물대 돌파 첫 눌림',tf:'m5',summary:'적격 돌파 이후 SMA120·반대 밴드·구간 재시험·50% 중 첫 조건입니다.'},
 {id:'5',name:'돌파 후 수축 기본비',tf:'m5',summary:'적격 돌파, 확장, 연속 2봉 수축 이후 첫 반대쪽 밴드 접촉입니다.'},
 {id:'6',name:'비오비 수축 돌파',tf:'m5',manual:true,summary:'사용자 선택: 실제 차트와 체크리스트로 수동 복기합니다. 자동 정답·성과 판정은 보류합니다.'},
 {id:'7',name:'돌파봉 25·50% 되돌림',tf:'m5',summary:'돌파봉 전체 길이의 25%·50%에 같은 수량을 계획합니다. 다음 2봉까지만 유효합니다.'},
 {id:'8',name:'역할전환 첫 재시험',tf:'m5',summary:'H1 돌파 구간을 재접촉하고 새 역할 방향으로 마감하는지 봅니다.'},
 {id:'9',name:'20·120 교차 첫 4·4 밴드',tf:'m5',summary:'최신 v16 기본: 20·120 교차 후 첫 반대쪽 4·4 접촉. 더블비를 포함합니다.'},
 {id:'jikil',name:'지킬 3분봉',tf:'m3',summary:'추세·역매매·초기 구간형을 구분하고, 상위 장애와 M3 장기이평을 함께 봅니다.'},
 {id:'benpark',name:'벤팍 1분봉',tf:'m1',summary:'A 매물대 반전 / B 추세 눌림 / C 돌파를 나누고 1분봉 반응을 확인합니다.'}
];
export const RULE_VERSION='2026-11-04-v1';
for(const mode of MODES)if(Number(mode.id))mode.tf='h1';
const finite=Number.isFinite,touch=(b,p)=>finite(p)&&b.low<=p&&b.high>=p,round=p=>Math.round((p+Number.EPSILON)*100)/100;
export function buildMarket(dataset){
 const frames={};for(const [tf,sec] of Object.entries(TF))if(sec>=dataset.interval&&sec%dataset.interval===0)frames[tf]=indicators(aggregate(dataset.bars,dataset.interval,sec));
 // Never splice a second provider or an overlapping externally completed H1 into M1-derived history.
 // External H1 may warm up only strictly before the first complete derived H1.
 if(dataset.upperBars?.length&&frames.h1){const first=frames.h1[0]?.time??Infinity,early=dataset.upperBars.filter(b=>b.time+3600<=first).map(b=>({...b,end:b.time+3600,complete:true}));frames.h1=indicators([...early,...frames.h1]);for(const tf of ['h2','h4'])frames[tf]=indicators(aggregate(frames.h1,3600,TF[tf]));}
 const zones=buildZoneTimeline(frames.h1||[],frames.m30||[]);
 return {dataset,frames,zones};
}
export function latestAt(arr,time){return arr[upperBound(arr,time)-1]??null;}
export function contextAt(market,time){const snapshot=latestAt(market.zones,time);const frames={};for(const [tf,bars] of Object.entries(market.frames))frames[tf]=latestAt(bars,time);return {snapshot:snapshot||{zones:[],broken:[],usHi:null,usLo:null,previousUSHi:null,previousUSLo:null},frames};}
function commonStop(snap,d,entry){const refs=snap.zones.filter(z=>z.res===(d<0)).map(z=>d>0?z.bot:z.top).filter(v=>d*(entry-v)>0);const us=d>0?snap.usLo:snap.usHi;if(finite(us)&&d*(entry-us)>0)refs.push(us);return refs.sort((a,b)=>Math.abs(a-entry)-Math.abs(b-entry))[0]??null;}
function targetFor(b,snap,d,entry,method,stop){
 if(method==='1')return round(entry+d*Math.abs(entry-stop));
 // Latest chart-entry indicators do not prescribe a full shared TP engine.
 // Do not import older TP defaults as if they were part of those indicators.
 return null;
}
export function buildTimeline(market,tf,mode,options={}){
 const bars=market.frames[tf];if(!bars)throw Error('이 시간봉에는 더 작은 실제 원시 데이터가 필요합니다.');
 const code=options.variant!=='document',state={},history=[];
 for(let i=0;i<bars.length;i++){
  const b=bars[i],p=bars[i-1],{snapshot:snap,frames}=contextAt(market,b.end);
  const result={time:b.end,mode,tf,candidate:null,reason:'조건 대기',checks:[],kind:mode==='6'?'manual':'code',levels:[],bar:b};
  const emit=(d,reason,custom={})=>{const entry=custom.limit??b.close,stop=custom.stop??commonStop(snap,d,entry),target=custom.target??targetFor(b,snap,d,entry,mode,stop);result.candidate={dir:d,reason,stop,target,reference:entry,...custom};result.reason=reason;};
  const required=['2','3','9','jikil'].includes(mode)?[b.sma120,b.sma60,b.bb20Low,b.bb4Low]:[b.bb20Low,b.bb4Low];
  const ready=required.every(finite);
  if(mode==='6'){result.reason='수동 복기 전용 · 자동 정답 판정 없음';history.push(result);continue;}
  if(mode==='benpark'){
   result.kind=options.experimental?'proposal':'manual';const setup=frames[options.setupTF||'m5'],h=frames.h1,trend=x=>x&&finite(x.sma20)?Math.sign(x.close-x.sma20):0;
   result.reason='상위 방향·매물대와 M1 반응을 직접 확인하세요.';
   if(setup){result.levels=[{price:setup.sma20,label:(options.setupTF||'m5')+' SMA20'}].filter(x=>finite(x.price));}
   if(options.experimental&&p&&setup&&h&&finite(setup.sma20)&&finite(h.sma20)){
    const setupBars=market.frames[options.setupTF||'m5'],si=upperBound(setupBars,b.end)-1,older=setupBars[si-3],range=p.high-p.low,body=Math.abs(p.close-p.open),lower=Math.min(p.open,p.close)-p.low,upper=p.high-Math.max(p.open,p.close);
    const hammer=range>0&&lower>=2*body&&upper<=.25*range&&p.close>=p.low+.65*range,star=range>0&&upper>=2*body&&lower<=.25*range&&p.close<=p.low+.35*range,doji=range>0&&body<=.2*range;
    let d=older&&setup.sma20>older.sma20&&trend(setup)>0&&trend(h)>0?1:older&&setup.sma20<older.sma20&&trend(setup)<0&&trend(h)<0?-1:0;
    const reaction=d>0?(hammer||doji)&&b.close>p.high:(star||doji)&&b.close<p.low;
    if((options.benType||'B')==='B'&&d&&touch(p,setup.sma20)&&reaction&&d*(b.close-setup.sma20)>0){const targets=[...snap.zones.filter(z=>z.res===(d>0)).map(z=>d>0?z.bot:z.top),d>0?snap.previousUSHi:snap.previousUSLo].filter(x=>finite(x)&&d*(x-b.close)>0).sort((x,y)=>Math.abs(x-b.close)-Math.abs(y-b.close));emit(d,'[실험] H1·자리봉 방향 일치 + SMA20 접촉 + M1 반전 확인',{stop:null,target:targets[0]??null});}
    result.reason=result.candidate?.reason||'[실험] B형 종가/SMA20·3봉 기울기·M1 패턴 조건 대기';
   }
   history.push(result);continue;
  }
  if(!ready||!p){result.reason='이평·밴드 계산용 과거 봉 부족';result.kind='unknown';history.push(result);continue;}
  const low=b.low<=b.bb20Low||b.low<=b.bb4Low,up=b.high>=b.bb20Up||b.high>=b.bb4Up,newLow=low&&!(p.low<=p.bb20Low||p.low<=p.bb4Low),newUp=up&&!(p.high>=p.bb20Up||p.high>=p.bb4Up),bull=b.sma20>b.sma60&&b.sma60>b.sma120,bear=b.sma20<b.sma60&&b.sma60<b.sma120,crossUp=b.sma20>b.sma120&&p.sma20<=p.sma120,crossDown=b.sma20<b.sma120&&p.sma20>=p.sma120,t120=touch(b,b.sma120);
  const broken=snap.end===b.end?snap.broken:[],zu=broken.find(z=>z.dir===1),zd=broken.find(z=>z.dir===-1),bu=!!zu,bd=!!zd,qu=bu&&b.high>=b.bb4Up&&(code||b.high>=b.bb20Up),qd=bd&&b.low<=b.bb4Low&&(code||b.low<=b.bb20Low);
  result.checks=[{label:'SMA20·60·120 배열',value:bull?'정배열':bear?'역배열':'혼합 배열'},{label:'H1 유효 매물대',value:snap.zones.length+'개'},{label:'현재 밴드 접촉',value:low&&up?'양쪽':low?'하단':up?'상단':'없음'}];
  if(mode==='jikil'){
   result.kind=options.experimental?'proposal':'manual';result.reason='상위 장애·시간·거래 유형을 직접 체크하세요.';
   if(options.jikilType!=='counter'){
    if(crossUp||crossDown)state.j={d:crossUp?1:-1,i};
    else if(state.j&&i>state.j.i&&t120){const d=state.j.d;emit(d,'20·120 교차 후 첫 SMA120 접촉',{stop:options.jikilType==='grid'?round(b.close-d*55):null,target:null});state.j=null;}
   }
   if(options.jikilType==='counter')result.reason='역매매: 시간봉 매수세·쌍비와 반등 목표를 직접 확인합니다. M3 장기선은 목표일 수 있습니다.';
   result.levels=[{price:b.sma120,label:'M3 장기이평'}];history.push(result);continue;
  }
  if(mode==='1')for(const [d,isNew,edge] of [[1,newLow,b.low],[-1,newUp,b.high]]){
   if(isNew){const old=state['v'+d],zone=snap.zones.find(z=>z.res===(d<0)&&rejection(z,b));if(old&&i-old.i>=3&&i-old.i<=8&&(old.zone||zone)){const bounds=[old.edge,edge];if(old.zone)bounds.push(old.bound);if(zone)bounds.push(d>0?zone.bot:zone.top);const stop=d>0?Math.min(...bounds):Math.max(...bounds);if(d*(b.close-stop)>0)emit(d,d>0?'매물대 W 변곡':'매물대 M 변곡',{stop});}state['v'+d]={i,edge,zone:!!zone,bound:zone?(d>0?zone.bot:zone.top):null};}
  }
  if(mode==='2'){if(bull&&newLow)emit(1,'정배열 + 새 하단 기본비');if(bear&&newUp)emit(-1,'역배열 + 새 상단 기본비');}
  if(mode==='3'){
   if(crossUp||crossDown)state.w={d:crossUp?1:-1,i};else if(state.w&&i>state.w.i){const w=state.w;if(w.d*(b.close-b.sma120)<0){state.w=null;result.reason='배열 반대쪽 종가로 첫 접촉 대기 무효';}else if(t120){if(w.d*(b.close-b.sma120)>0)emit(w.d,'교차 후 첫 SMA120 접촉·방향 종가');state.w=null;}}
  }
  if(mode==='4'||mode==='5'){
   if(state.w&&((state.w.d>0&&(bd||crossDown))||(state.w.d<0&&(bu||crossUp))))state.w=null;
   if(qu||qd){const d=qu?1:-1,z=qu?zu:zd,prior=bars.slice(Math.max(0,i-10),i),anchor=d>0?Math.min(...prior.map(b=>b.low)):Math.max(...prior.map(b=>b.high));state.w={d,i,top:z.top,bot:z.bot,half:d>0?(anchor+b.high)/2:(anchor+b.low)/2,expanded:b.bb4Up-b.bb4Low>p.bb4Up-p.bb4Low,count:0,armed:null};}
   const w=state.w;if(w&&i>w.i){const d=w.d;
    if(mode==='4'){
     const touchedBands=(d>0?[b.bb20Low,b.bb4Low]:[b.bb20Up,b.bb4Up]).filter(v=>d>0?b.low<=v:b.high>=v),band=touchedBands.length?(d>0?Math.max(...touchedBands):Math.min(...touchedBands)):null;
     const maHit=t120&&d*(b.close-b.sma120)>0,bandHit=finite(band)&&d*(b.close-band)>0,zoneHit=b.low<=w.top&&b.high>=w.bot&&(d>0?b.close>w.top:b.close<w.bot),halfHit=touch(b,w.half)&&d*(b.close-w.half)>0;
     if(maHit||(code&&(bandHit||zoneHit||halfHit))){emit(d,maHit?'돌파 후 첫 SMA120':bandHit?'돌파 후 첫 반대 밴드':zoneHit?'돌파 매물대 재시험':'돌파 후 50% 되돌림');state.w=null;}
    }else{const width=b.bb4Up-b.bb4Low,pwidth=p.bb4Up-p.bb4Low,contract=width<pwidth&&b.bb4Up<p.bb4Up&&b.bb4Low>p.bb4Low;w.expanded||=width>pwidth;w.count=w.expanded&&contract?w.count+1:0;if(w.count>=2&&w.armed===null)w.armed=i;if(w.armed!==null&&i>w.armed&&(d>0?low:up)){emit(d,'확장·2봉 수축 후 첫 반대 기본비');state.w=null;}}
   }
  }
  if(mode==='7'){
   if(!state.w&&(qu||qd)){const d=qu?1:-1,r=b.high-b.low,a=round(d>0?b.high-r*.25:b.low+r*.25),c=round(d>0?b.high-r*.5:b.low+r*.5),stop=commonStop(snap,d,(a+c)/2);if(finite(stop)&&d*(Math.min(d*a,d*c)*d-stop)>0)state.w={d,i,a,c,stop,expires:b.end+TF[tf]*2};}
   if(state.w){const w=state.w;if(b.end>=w.expires){state.w=null;result.reason='돌파 다음 2봉 완료 · 새 지정가 계획 만료';}else{emit(w.d,'돌파봉 25%·50% 지정가 계획',{limit:w.a,addLevels:[w.c],stop:w.stop,expires:w.expires,planned:true});result.levels=[{price:w.a,label:'25% 진입 계획'},{price:w.c,label:'50% 추가 계획'}];}}
  }
  if(mode==='8'){
   if(bu||bd){const d=bu?1:-1,z=bu?zu:zd;state.w={d,i,top:z.top,bot:z.bot,touched:false};}
   const w=state.w;if(w&&i>w.i){if(i-w.i>10||(w.d>0?b.close<w.bot:b.close>w.top))state.w=null;else{w.touched||=b.low<=w.top&&b.high>=w.bot;if(w.touched&&(w.d>0?b.close>w.top:b.close<w.bot)){emit(w.d,'역할전환 첫 재시험 성공');state.w=null;}}}
  }
  if(mode==='9'){
   if(crossUp||crossDown)state.w={d:crossUp?1:-1,i};const w=state.w;
   if(w&&i>w.i){const bb4=w.d>0?b.low<=b.bb4Low:b.high>=b.bb4Up,pure=w.d>0?b.low>b.bb20Low:b.high<b.bb20Up;if(bb4&&(code||pure)){emit(w.d,code?'20·120 교차 후 첫 4·4 접촉':'20·120 교차 후 첫 순수 4·4 원비');state.w=null;}else if(bb4&&!pure)result.reason='더블비 제외 · 첫 순수 원비 대기';}
  }
  if(result.candidate){const c=result.candidate;if(!finite(c.stop)||c.dir*(c.reference-c.stop)<=0){result.reason+=' · 구조적 손절 없음';result.candidate=null;}else if(c.target!=null&&c.dir*(c.target-c.reference)<=0)c.target=null;}
  if(!result.candidate&&state.w)result.reason='선행 조건 확인 · 후속 첫 접촉 대기';history.push(result);
 }
 return history;
}
export function assess(base,manual={},options={}){
 const result={...base,checks:[...base.checks],status:base.kind==='unknown'?'unknown':base.candidate?'candidate':'wait',blocks:[],manualRequired:false};
 if(base.mode==='6'){result.status='manual';return result;}
 if(base.mode==='jikil'||base.mode==='benpark'){
  result.manualRequired=true;const d=options.intendedDirection??base.candidate?.dir;
  const obstacle=manual.obstacle??'unknown',news=manual.news??'unknown',reaction=manual.reaction??'unknown',direction=manual.direction??'unknown';
  result.checks.push({label:'사용자 상위 장애 체크',value:obstacle},{label:'사용자 방향 판단',value:direction},{label:'사용자 M1/M3 반응 체크',value:reaction});
  if(obstacle==='both'||(d===1&&obstacle==='buy')||(d===-1&&obstacle==='sell'))result.blocks.push('사용자가 기록한 상위 반대 장애');
  if(base.mode==='jikil'){
   result.checks.push({label:'사용자 시간·발표 체크',value:news});if(news==='blocked')result.blocks.push('신규 진입 금지 시간·발표');
   if(d&&options.jikilType==='trend'&&((d>0&&direction==='down')||(d<0&&direction==='up')))result.blocks.push('추세형과 상위 방향 불일치');
  }
  const known=obstacle!=='unknown'&&direction!=='unknown'&&reaction!=='unknown'&&(base.mode!=='jikil'||news!=='unknown');
  if(result.blocks.length)result.status='blocked';else if(!known)result.status='manual';else if(!options.experimental){result.status='manual';result.reason='원문 체크 완료 · 진입의 최종 판단과 계획은 직접 기록합니다.';}else if(reaction==='no'){result.status='wait';result.reason='수동 반응 확인 미충족';}
  result.manualComplete=known;
 }
 return result;
}
