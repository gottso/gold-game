import {TF,TF_LABEL,normalize,decodeStored,parseCsv,fetchRecent,upperBound,indicators,tradableKST} from './practice-data.js';
import {MODES,RULE_VERSION,buildMarket,buildTimeline,contextAt,assess} from './practice-rules.js';
import {PaperBroker,positionSummary,unrealized,splitLots} from './practice-broker.js';
const $=id=>document.getElementById(id),finite=Number.isFinite;
const fmt=(v,n=2)=>finite(v)?v.toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n}):'—';
const stamp=t=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t*1000));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(id,value)=>$(id).textContent=value;
let noticeTimer,market=null,dataset=null,timeline=[],session=null,charts=null,decided=false,lastPlanStamp=null,loading=false;
const datasets=new Map(),memory=new Map();
let mode=new URLSearchParams(location.search).get('mode')||'1';if(!MODES.some(m=>m.id===mode))mode='1';
function notice(message){text('notice',message);$('notice').classList.add('on');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').classList.remove('on'),7000);}
const options=()=>({variant:$('variant').value,experimental:$('experimental').checked,jikilType:$('jikil-type').value,benType:$('ben-type').value,setupTF:$('setup-tf').value});
const manual=()=>({direction:$('manual-direction').value,obstacle:$('manual-obstacle').value,reaction:$('manual-reaction').value,news:$('manual-news').value,note:$('manual-note').value});
function clearManual(){for(const id of ['manual-direction','manual-obstacle','manual-reaction','manual-news'])$(id).value='unknown';$('manual-note').value='';}
const isSpecial=()=>mode==='jikil'||mode==='benpark';
function key(){const o=options();return ['gold-practice',RULE_VERSION,dataset.id,mode,$('step-tf').value,o.variant,o.jikilType,o.benType,o.setupTF,o.experimental?'experimental':'source'].join(':');}
function persist(){if(!session)return;const value={cursor:session.cursor,broker:session.broker.snapshot(),manual:manual(),decided};memory.set(session.key,value);try{localStorage.setItem(session.key,JSON.stringify(value));}catch{notice('브라우저 저장 공간이 부족합니다. 복기를 내보내 주세요. 현재 연습은 메모리에서 계속됩니다.');}}
function restoreValue(k){if(memory.has(k))return memory.get(k);try{const v=JSON.parse(localStorage.getItem(k));if(v&&finite(v.cursor)&&finite(v.broker?.balance)&&Array.isArray(v.broker.journal))return v;}catch{}return null;}
function makeCharts(){
 if(!window.LightweightCharts){notice('차트 라이브러리를 불러오지 못했습니다. 네트워크를 확인하고 새로고침해 주세요.');return null;}
 function make(id){const el=$(id),chart=LightweightCharts.createChart(el,{width:el.clientWidth,height:el.clientHeight,layout:{background:{color:'#161b22'},textColor:'#a3afbf',fontFamily:'Segoe UI, Malgun Gothic, sans-serif'},grid:{vertLines:{color:'#202833'},horzLines:{color:'#202833'}},rightPriceScale:{borderColor:'#2a3340'},timeScale:{borderColor:'#2a3340',timeVisible:true,secondsVisible:false,rightOffset:4},localization:{timeFormatter:t=>stamp(Number(t))},crosshair:{mode:LightweightCharts.CrosshairMode.Normal}});
  const candles=chart.addCandlestickSeries({upColor:'#37b47d',downColor:'#e56f68',borderVisible:false,wickUpColor:'#37b47d',wickDownColor:'#e56f68'}),lines={};
  for(const [name,color] of [['sma20','#76a4ff'],['sma60','#f7b35c'],['sma120','#c29af0'],['bb20Up','#6c7c8e'],['bb20Low','#6c7c8e'],['bb4Up','#b7a975'],['bb4Low','#b7a975']])lines[name]=chart.addLineSeries({color,lineWidth:name.startsWith('sma')?2:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
  new ResizeObserver(()=>chart.resize(el.clientWidth,el.clientHeight)).observe(el);return {chart,candles,lines,priceLines:[]};
 }
 return {main:make('main-chart'),upper:make('upper-chart')};
}
function visibleFrame(tf,time){
 const all=market.frames[tf]||[],end=upperBound(all,time),completed=all.slice(Math.max(0,end-350),end),sec=TF[tf];
 if(!sec||time%sec===0||sec===dataset.interval)return completed;
 const offset=sec>=7200?7200:0,start=Math.floor((time+offset)/sec)*sec-offset;
 const from=upperBound(dataset.bars,start-1,'time'),to=upperBound(dataset.bars,time-dataset.interval,'time'),raw=dataset.bars.slice(from,to);
 if(!raw.length||raw[0].time!==start)return completed;
 const partial={time:start,open:raw[0].open,high:Math.max(...raw.map(b=>b.high)),low:Math.min(...raw.map(b=>b.low)),close:raw.at(-1).close,volume:raw.reduce((s,b)=>s+b.volume,0),end:start+sec,complete:false};
 const recent=indicators([...completed.slice(-125),partial]);return [...completed,recent.at(-1)];
}
function drawChart(obj,bars,follow){
 obj.candles.setData(bars.map(({time,open,high,low,close})=>({time,open,high,low,close})));
 for(const [k,line] of Object.entries(obj.lines))line.setData(bars.filter(b=>finite(b[k])).map(b=>({time:b.time,value:b[k]})));
 if(follow&&bars.length)obj.chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-85),to:bars.length+3});
 for(const l of obj.priceLines)obj.candles.removePriceLine(l);obj.priceLines=[];
}
function chartsRender(follow=true){
 if(!charts)return;let tf=$('view-tf').value==='auto'?$('step-tf').value:$('view-tf').value;if(!market.frames[tf])tf=$('step-tf').value;const upperTF=$('upper-tf').value,mainBars=visibleFrame(tf,session.cursor),upper=visibleFrame(upperTF,session.cursor);
 drawChart(charts.main,mainBars,follow);drawChart(charts.upper,upper,follow);
 const snap=contextAt(market,session.cursor).snapshot,ps=positionSummary(session.broker.position);
 if(ps)for(const [price,title,color] of [[ps.average,'평균단가','#a8b4c7'],[ps.stop,'손절','#ff837b'],[ps.target,'목표','#4ed59a']])if(finite(price))charts.main.priceLines.push(charts.main.candles.createPriceLine({price,color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title}));
 for(const z of snap.zones.slice(-8))for(const price of [z.bot,z.top])charts.upper.priceLines.push(charts.upper.candles.createPriceLine({price,color:z.res?'#a66a62':'#528e75',lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''}));
 const markers=session.broker.journal.filter(e=>['entry','add','close'].includes(e.type)&&e.time<session.cursor).slice(-25).map(e=>{const bucket=Math.floor(e.time/TF[tf])*TF[tf];const exists=mainBars.some(b=>b.time===bucket);return exists?{time:bucket,position:e.type==='close'?'aboveBar':'belowBar',color:e.type==='close'?'#e8b84b':'#76a4ff',shape:e.type==='close'?'circle':'arrowUp',text:e.type==='close'?'청산':e.type==='add'?'추가':'진입'}:null;}).filter(Boolean).sort((a,b)=>a.time-b.time);
 // Chart library accepts multiple same-time markers; every marker is revealed only after execution.
 charts.main.candles.setMarkers(markers);
 text('upper-note',upper.length?(upper.at(-1).complete?'확정봉만 표시':'마지막 봉 진행 중 · 그 시점까지의 OHLC'):'이 구간에 완성된 상위봉 자료가 없습니다.');
 text('chart-label',`${TF_LABEL[tf]} 관찰 · 신호 ${TF_LABEL[$('step-tf').value]} · ${mainBars.at(-1)?.complete===false?'진행 중':'마감 확인'}`);
 $('zones').replaceChildren();if(!snap.zones.length){text('zones','현재 시점에 확인된 v16 유효 매물대 없음');}else for(const z of snap.zones.slice(-8)){const el=document.createElement('span');el.textContent=`${z.res?'저항':'지지'} ${fmt(z.bot)}~${fmt(z.top)} · ${z.kind}`;$('zones').append(el);}
}
function currentPrice(){return dataset.bars[upperBound(dataset.bars,session.cursor-dataset.interval,'time')-1]?.close??null;}
function currentAssessment(intendedDirection){const i=upperBound(timeline,session.cursor,'time')-1,base=timeline[i]||{mode,tf:$('step-tf').value,kind:'unknown',reason:'아직 완성된 타점 봉이 없습니다.',candidate:null,checks:[]};return assess(base,manual(),{...options(),intendedDirection});}
function render(follow=false){
 if(!session)return;const price=currentPrice(),broker=session.broker,ps=positionSummary(broker.position),upl=unrealized(broker.position,price,broker.spread),a=currentAssessment(),revealed=$('lesson').value==='learn'||decided;
 text('current-price',fmt(price));text('clock',stamp(session.cursor)+' KST');text('equity','$'+fmt(broker.balance+upl));text('balance','$'+fmt(broker.balance));text('upl',(upl>=0?'+':'')+'$'+fmt(upl));
 $('upl').className=upl>0?'positive':upl<0?'negative':'';
 $('position').replaceChildren();
 if(ps){$('position').innerHTML=`<p>${broker.position.dir>0?'매수':'매도'} ${fmt(ps.lots,2)}랏 · ${ps.count}회 체결</p><p>평균 ${fmt(ps.average)} / E0 ${fmt(ps.entry0)}</p><p>손절 ${fmt(ps.stop)} / 목표 ${fmt(ps.target)}</p>`;}
 else text('position',broker.pending?'다음 실제 봉에서 가상 체결 대기'+(finite(broker.pending.limit)?' · 지정가 '+fmt(broker.pending.limit):' · 시장가'):'보유·예약 없음');
 if(broker.assumptions){const p=document.createElement('p');p.textContent=`OHLC 순서 가정 ${broker.assumptions}회 포함 · 실제 체결 성과가 아닙니다.`;$('position').append(p);}
 $('ambiguity').hidden=!broker.ambiguity;
 if(broker.ambiguity){$('ambiguity').innerHTML='<strong>같은 봉의 체결 순서가 불명확합니다.</strong><p>더 작은 관측값이 없어 OHLC/OLHC에서 결과가 달라집니다. 가정을 선택하면 기록에 남깁니다.</p>';for(const path of ['OHLC','OLHC']){const b=document.createElement('button');b.textContent=path==='OHLC'?'시가→고가→저가→종가 가정':'시가→저가→고가→종가 가정';b.onclick=()=>{broker.resolve(path);persist();render();};$('ambiguity').append(b);}}
 const status={candidate:'진입 조건 후보',wait:'조건 대기',blocked:'신규 진입 금지 근거',manual:'수동 확인·판단',unknown:'자료 부족'};
 $('assessment').innerHTML=revealed?`<strong class="status-${a.status}">${status[a.status]||'직접 복기'}</strong><p>${esc(a.reason)}</p>${a.blocks.length?'<p>'+esc(a.blocks.join(' / '))+'</p>':''}`:'<strong>직접 판단해 보세요</strong><p>매수·매도·관망을 고르면 당시 조건의 해설을 보여줍니다.</p>';
 $('checks').replaceChildren();if(revealed)for(const c of a.checks){const row=document.createElement('div');row.className='check-row';const label=document.createElement('span'),value=document.createElement('span');label.textContent=c.label;value.textContent=c.value;row.append(label,value);$('checks').append(row);}
  if(revealed&&a.candidate&&lastPlanStamp!==a.time+':'+mode){lastPlanStamp=a.time+':'+mode;$('stop').value=finite(a.candidate.stop)?a.candidate.stop.toFixed(2):'';$('target').value=finite(a.candidate.target)?a.candidate.target.toFixed(2):'';if(mode==='7'){$('limit-price').value=finite(a.candidate.limit)?a.candidate.limit.toFixed(2):'';$('add-price').value=a.candidate.addLevels?.[0]?.toFixed(2)||'';}}
 text('wait',ps?'유지':'관망');$('next').disabled=!!broker.ambiguity||session.cursor>=dataset.bars.at(-1).time+dataset.interval;$('next-setup').disabled=isSpecial()||mode==='6'||!!ps||!!broker.pending||!!broker.ambiguity;
 $('buy').disabled=$('sell').disabled=!!ps||!!broker.pending||!!broker.ambiguity||!charts;
 text('next',`다음 ${TF_LABEL[$('step-tf').value]}봉 →`);
 const o=options();text('risk-note',mode==='benpark'?`전체 비중을 최초 포함 총 3회에 분할합니다. 10·20포 역행 추가, 묶음 계좌 손절 ${$('budget').value}%. 추가는 가격 도달 방식 [실행 가정].`:mode==='jikil'&&o.jikilType==='grid'?'초기 구간형만 적용: E0 기준 10포 간격, 최초 포함 최대 6회, 손절 E0±55. 2회 이상 후 E0 회복 청산. 추세·역매매 공통값이 아닙니다.':'손절·목표가 자동으로 채워지지 않으면 직접 계획합니다. 신규 진입은 다음 실제 원시 봉 시가에 가상 체결합니다.');
 renderJournal();chartsRender(follow);
}
function renderJournal(){
 const journal=session.broker.journal;text('journal-count',`(${journal.length}건)`);$('journal').replaceChildren();
 for(const e of journal.slice(-60).reverse()){
  const row=document.createElement('div');row.className='journal-entry';const t=document.createElement('time'),v=document.createElement('div');t.textContent=stamp(e.time);let msg;
  if(e.type==='decision')msg=`${e.action==='buy'?'매수 선택':e.action==='sell'?'매도 선택':e.action==='close'?'청산 선택':'관망·유지 선택'} · ${e.assessment?.status||'직접 판단'} · ${e.assessment?.reason||''}${e.manual?.note?' / '+e.manual.note:''}`;
  else if(e.type==='plan')msg='주문 계획 저장 · 다음 원시 봉부터 유효';
  else if(e.type==='entry'||e.type==='add')msg=`${e.type==='entry'?'진입':'추가'} ${fmt(e.price)} · ${fmt(e.lots)}랏`;
  else if(e.type==='close')msg=`${e.reason} ${fmt(e.price)} · 손익 $${fmt(e.profit)}${e.assumption?' · '+e.assumption:''}`;
  else if(e.type==='assumption')msg=`${e.path} 봉내 순서 가정 선택`;
  else msg=e.reason||e.type;
  v.textContent=msg;row.append(t,v);$('journal').append(row);
 }
 if(!journal.length)text('journal','이 매매법의 판단·체결 기록이 여기에 저장됩니다.');
}
function initializeSession(reset=false,time=null){
 const k=key(),old=reset?null:restoreValue(k),bars=market.frames[$('step-tf').value]||[];
 if(bars.length<5)throw Error('이 시간봉의 완성된 실제 봉이 부족합니다. 더 작은 시간봉이나 다른 데이터 구간을 선택해 주세요.');
 const available=bars.filter(b=>b.end>=dataset.bars[0].time+dataset.interval&&b.end<=dataset.bars.at(-1).time+dataset.interval);if(!available.length)throw Error('원시 시세와 타점 봉의 시간이 겹치지 않습니다.');
 const start=available[Math.min(available.length-1,Math.floor(available.length*.35))].end;
 session={key:k,cursor:time??old?.cursor??start,broker:old?PaperBroker.restore(old.broker):new PaperBroker({balance:+$('initial').value||1000,spread:+$('spread').value||0})};
 session.cursor=Math.min(dataset.bars.at(-1).time+dataset.interval,Math.max(dataset.bars[0].time+dataset.interval,session.cursor));
 decided=old?.decided||false;clearManual();if(old?.manual)for(const [k,v] of Object.entries(old.manual)){const el=$('manual-'+k);if(el)el.value=v;}
 $('spread').value=session.broker.spread;$('initial').value=session.broker.initial;lastPlanStamp=null;for(const id of ['stop','target','limit-price','add-price'])$(id).value='';text('decision-feedback','');
 $('start-time').value=new Date((session.cursor+32400)*1000).toISOString().slice(0,16);
 timeline=buildTimeline(market,$('step-tf').value,mode,options());persist();render(true);
}
function applyMode(){
 const m=MODES.find(m=>m.id===mode);text('mode-title',(Number(mode)?mode+' · ':'')+m.name);text('mode-summary',m.summary);
 $('nine-options').hidden=isSpecial()||mode==='6';$('special-options').hidden=!isSpecial();$('jikil-options').hidden=mode!=='jikil';$('ben-options').hidden=mode!=='benpark';$('manual-panel').hidden=!isSpecial();$('news-label').hidden=mode!=='jikil';$('ben-risk').hidden=mode!=='benpark';$('limit-plan').hidden=mode!=='7';
 $('step-tf').replaceChildren();for(const tf of isSpecial()?[m.tf]:$('variant').value==='code'?['h1']:['h1','m5']){const op=new Option(TF_LABEL[tf]+(!isSpecial()&&tf==='m5'?' [문서 변형]':''),tf);$('step-tf').add(op);}
 $('step-tf').value=m.tf;
 text('rule-kind',mode==='6'?'수동 복기 전용 · 자동 정답 판정 보류':isSpecial()?'원문 체크 기본 · [제안] 수치 실험 선택 가능':'최신 v16 코드 기본 · 실제 체결과의 차이는 별도 기록');
 $('rule-details').innerHTML=mode==='6'?'<p>사용자 확정: 6번은 모드만 제공하고 자동 정답 판정을 보류합니다. 시세·위험 계획·가상 체결·복기 기록은 사용할 수 있습니다.</p>':mode==='jikil'?'<p>[원문·사용자 확정] 2026-11-03 지킬·물뚜껑 통합 정리 기준. 추세와 역매매를 구분하고, 초기 10/50/55는 별도 관리형입니다.</p><p>[미정] 상위 기울기 계산, 이전 저점 선정, 봉내 근거 해제·재활성화의 일부 수식. 자동 확정하지 않고 직접 체크합니다.</p><p>[실험] 교차봉 제외·교차 후 첫 SMA120 접촉은 물뚜껑 해석과 기존 모델의 부분 구현입니다. 상위 조건 전체 자동화가 아닙니다. 초기 구간형의 반대 배열 재접촉 청산은 마감 확인 후 종가로 처리합니다.</p>':mode==='benpark'?'<p>[원문] A/B/C를 분리하고 큰 방향·5/10분 자리·1분 반응을 직접 확인합니다.</p><p>[사용자 확정 v6] 1분 마감 판단, 계좌 $1,000당 전체 비중 5%=0.05랏, 3회 분할, 역행 10·20포 추가, 계좌 대비 묶음 손절 기본 10%.</p><p>[실험] 자동 후보는 B형만 지원합니다. H1·자리봉의 종가/SMA20, 자리봉 SMA20의 3봉 기울기, 도지·망치 후 다음 봉 확인을 사용합니다. 원문 강한 추세 전체를 재현하지 않습니다. A/C는 수동 판정입니다.</p>':'<p>[기존 구현] 2026-10-22 v16·장기120 지표의 조건을 기본으로 옮겼습니다. H1 매물대와 선택 타점봉의 이평·밴드를 구분합니다.</p><p>문서 변형: 4·5번은 더블비 돌파, 4번 첫 SMA120, 9번 순수 4·4 원비만 허용합니다. 6번 자동 판정은 사용자 선택으로 보류합니다.</p><p>H1 매물대는 기존 v16 수치 재구성 소스를 이식했습니다. TradingView 런타임 일치나 원문의 전체 재량을 검증했다는 뜻은 아닙니다.</p>';
 $('rule-details').insertAdjacentHTML('beforeend','<p>9종 최신 코드의 신호 계산은 H1입니다. 관찰 차트를 바꿔도 신호·진행 단위는 변하지 않습니다. 1번 1R 외의 공통 익절은 원문·진입 지표에 확정되지 않아 직접 계획합니다.</p><p>모든 판단은 당시 공개된 봉만 사용합니다. 부분 상위봉은 표시만 하며 확정봉 판정에 섞지 않습니다. 2·4시간봉 경계는 기존 게임과 같은 KST 07시 기준입니다.</p><p><a href="PRACTICE.md" target="_blank" rel="noopener">전체 규칙·출처·검증 범위</a></p>');
}
async function loadScript(src){if(document.querySelector(`script[data-source="${src}"]`))return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.dataset.source=src;s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('실제 시세 파일을 읽지 못했습니다.'));};document.head.append(s);});}
async function selectData(id){
 if(loading)return;loading=true;document.querySelector('main').classList.add('busy');
 try{
  if(!datasets.has(id)){
   if(id==='history'){await loadScript('data_m5.js');const n=normalize(decodeStored(window.XAU_M5).slice(-20000),300);datasets.set(id,{id:'repo-m5-88be1db-last20000',label:'기존 게임 저장 실제 시세 · 마지막 20,000개 M5',symbol:'XAUUSD',provider:'골드게임 저장 파일',interval:300,bars:n.bars,audit:n.audit});}
   else throw Error('이 데이터를 현재 세션에서 찾을 수 없습니다. 다시 가져와 주세요.');
  }
  if(session)persist();const chosen=datasets.get(id);
  if(isSpecial()&&chosen.interval!==60){notice('지킬 3분봉·벤팍 1분봉에는 실제 M1이 필요합니다. MT5 M1 표본을 표시합니다.');id='sample';}
  dataset=datasets.get(id);market=buildMarket(dataset);$('dataset').value=id;for(const op of $('view-tf').options)op.disabled=op.value!=='auto'&&!market.frames[op.value];
  text('source-info',`${dataset.label} · ${dataset.provider} · 원시 ${dataset.interval/60}분 · ${stamp(dataset.bars[0].time)} ~ ${stamp(dataset.bars.at(-1).time+dataset.interval)} KST · ${dataset.bars.length.toLocaleString()}봉${dataset.fetchedAt?' · 받은 시각 '+stamp(Date.parse(dataset.fetchedAt)/1000):' · 최신 시세 자동 갱신 아님'} · 공백 ${dataset.audit?.gaps??0}곳(주말 포함)`);
  text('chart-symbol',dataset.symbol||'XAUUSD');initializeSession();
 }catch(e){notice(e.message);}finally{loading=false;document.querySelector('main').classList.remove('busy');}
}
function structuralExit(time,raw){
 const p=session.broker.position;if(mode!=='jikil'||!p||p.manage!=='grid')return;
 const b=contextAt(market,time).frames.m3;if(!b||b.end!==time||!finite(b.sma120)||!finite(b.sma20))return;
 if(p.dir*(b.sma20-b.sma120)<0&&!p.oppositeSince)p.oppositeSince=b.end;
 if(p.oppositeSince&&b.end>p.oppositeSince&&b.low<=b.sma120&&b.high>=b.sma120)session.broker.close(raw.close,time,'반대 배열 후 SMA120 재접촉 · 마감 확인 종가 가정');
}
function advance(to){
 const raw=dataset.bars,from=upperBound(raw,session.cursor-dataset.interval,'time'),end=upperBound(raw,to-dataset.interval,'time');
 for(let i=from;i<end;i++){session.broker.process(raw[i]);session.cursor=raw[i].time+dataset.interval;if(session.broker.ambiguity)break;structuralExit(session.cursor,raw[i]);}
 decided=false;clearManual();text('decision-feedback','');lastPlanStamp=null;persist();render(true);
}
function next(){
 if(!session||session.broker.ambiguity)return;
 const bars=market.frames[$('step-tf').value],i=upperBound(bars,session.cursor),next=bars[i];if(!next){notice('이 데이터 구간의 마지막 봉입니다. 최근 시세를 받거나 다른 실제 CSV를 가져와 주세요.');return;}advance(next.end);
}
function recordDecision(action){
 const a=currentAssessment(action==='buy'?1:action==='sell'?-1:undefined),entry={time:session.cursor,type:'decision',action,mode,ruleVersion:RULE_VERSION,variant:options(),manual:manual(),assessment:{status:a.status,reason:a.reason,checks:structuredClone(a.checks),blocks:[...a.blocks],candidate:structuredClone(a.candidate)},source:{id:dataset.id,provider:dataset.provider,symbol:dataset.symbol,interval:dataset.interval}};
 session.broker.journal.push(entry);decided=true;return a;
}
function order(dir){
 try{
  const a=recordDecision(dir>0?'buy':'sell'),c=a.candidate?.dir===dir?a.candidate:null,o=options();
  // Values hidden in an exam must never be silently used as an oracle order plan.
  const revealed=$('lesson').value==='learn';
  const read=id=>$(id).value.trim()===''?null:Number($(id).value);
  let stop=read('stop'),target=read('target'),lots=read('lots'),manage='manual',planLots=[lots],addLevels=[],limit=null,expires=null;
  if(revealed&&c){stop??=c.stop;target??=c.target;}
  if(mode==='benpark'){manage='benpark';const allocation=Number($('allocation').value),budgetPct=Number($('budget').value);if(!(allocation>0&&allocation<=100&&budgetPct>0&&budgetPct<=100))throw Error('전체 비중·묶음 손절은 0 초과 100 이하로 입력해 주세요.');const total=session.broker.balance*allocation/100/10/100;planLots=splitLots(total,3);}
  if(mode==='jikil'&&o.jikilType==='grid'){manage='grid';planLots=Array(6).fill(lots);stop=null;}
  if(mode==='7'){limit=read('limit-price');const add=read('add-price');if(!finite(limit)||!finite(add))throw Error('7번은 진입 전에 25%·50% 지정가를 계획해 주세요.');if(dir*(limit-add)<=0)throw Error('50% 추가는 최초 지정가보다 역행 방향이어야 합니다.');expires=c?.expires??session.cursor+TF[$('step-tf').value]*2;addLevels=[add];planLots=[lots,lots];}
  if(manage==='manual'&&!finite(stop))throw Error('손절 가격을 먼저 입력해 주세요. 선택과 해설은 기록했습니다.');
  const px=currentPrice();if(finite(stop)&&dir*(px-stop)<=0)throw Error('현재 가격에 맞는 손절 방향을 확인해 주세요.');if(finite(target)&&dir*(target-px)<=0)throw Error('현재 가격에 맞는 이익 방향 목표를 입력해 주세요.');
  session.broker.plan({dir,stop,target,planLots,addLevels,limit,expires,manage,budgetPct:Number($('budget').value)},session.cursor);
  text('decision-feedback',(a.status==='blocked'?'금지 근거가 있는 선택을 연습 기록에 남겼습니다. ':a.kind==='manual'?'원문 재량 선택을 기록했습니다. ':'선택과 당시 근거를 기록했습니다. ')+(finite(limit)?'지정가 예약':'다음 실제 원시 봉 시가 체결 대기'));
 }catch(e){text('decision-feedback',e.message);notice(e.message);}finally{persist();render();}
}
async function recent(){
 if(loading)return;const btn=$('recent');btn.disabled=true;btn.textContent='실제 시세 받는 중…';
 try{const key=$('api-key').value.trim()||sessionStorage.getItem('goldTrainingKey');const fresh=await fetchRecent(key);datasets.set('recent',fresh);if(!$('dataset').querySelector('[value="recent"]'))$('dataset').add(new Option('최근 받은 실제 M1','recent'));try{sessionStorage.setItem('goldTrainingRecent',JSON.stringify(fresh));if(key)sessionStorage.setItem('goldTrainingKey',key);}catch{notice('받은 시세는 현재 화면에서 사용합니다. 세션 저장 공간이 부족합니다.');}await selectData('recent');notice('받은 범위의 실제 완료 봉을 불러왔습니다. 제공처·마지막 봉 시각을 확인해 주세요.');}
 catch(e){notice('최근 데이터 연결: '+e.message+' 기존 데이터는 유지합니다.');}
 finally{btn.disabled=false;btn.textContent='최근 실제 시세 받기';}
}
function bind(){
 for(const m of MODES)$('mode').add(new Option((Number(m.id)?m.id+' · ':'')+m.name,m.id));$('mode').value=mode;applyMode();
 $('mode').onchange=async()=>{if(session)persist();mode=$('mode').value;applyMode();const id=dataset&&dataset.interval>60&&isSpecial()?'sample':$('dataset').value;await selectData(id);};
 $('dataset').onchange=()=>selectData($('dataset').value);
 for(const id of ['experimental','jikil-type','ben-type','setup-tf','step-tf'])$(id).onchange=()=>{persist();initializeSession();};
 $('variant').onchange=()=>{persist();applyMode();initializeSession();};
 $('lesson').onchange=()=>render();$('upper-tf').onchange=$('view-tf').onchange=()=>chartsRender(true);
 for(const id of ['manual-direction','manual-obstacle','manual-reaction','manual-news','manual-note'])$(id).onchange=()=>{persist();render();};
 $('next').onclick=next;$('buy').onclick=()=>order(1);$('sell').onclick=()=>order(-1);
 $('wait').onclick=()=>{recordDecision('wait');text('decision-feedback','판단과 당시 근거를 기록했습니다. 다음 봉으로 진행해 보세요.');persist();render();};
 $('close').onclick=()=>{try{recordDecision('close');session.broker.close(currentPrice(),session.cursor);text('decision-feedback','현재까지 공개된 종가로 가상 정리했습니다.');persist();render();}catch(e){notice(e.message);}};
 $('reset').onclick=()=>{if(session.broker.position||session.broker.pending){if(!confirm('현재 모드의 거래를 포함해 새 가상 연습을 시작할까요? 기존 기록은 복기 내보내기로 보관할 수 있습니다.'))return;}initializeSession(true);};
 $('jump').onclick=()=>{const t=Date.parse($('start-time').value+':00+09:00')/1000;if(!finite(t)||t<dataset.bars[0].time||t>dataset.bars.at(-1).time+dataset.interval){notice('현재 실제 데이터 범위 안의 한국시간을 입력해 주세요.');return;}if(session.broker.position||session.broker.pending){notice('시점을 바꾸기 전에 현재 보유·예약을 정리해 주세요.');return;}initializeSession(true,t);};
 $('next-setup').onclick=()=>{const i=upperBound(timeline,session.cursor,'time'),target=timeline.slice(i).find(x=>x.candidate);if(!target){notice('남은 실제 구간에 자동 후보가 없습니다.');return;}advance(target.time);notice('중간 실제 봉을 공개하며 다음 후보 시점까지 진행했습니다.');};
 $('spread').onchange=()=>{const n=Number($('spread').value);if(!finite(n)||n<0){$('spread').value=session.broker.spread;return;}if(session.broker.position||session.broker.pending){notice('보유·예약 중에는 비용 조건을 변경할 수 없습니다.');$('spread').value=session.broker.spread;return;}session.broker.spread=n;persist();render();};
 $('recent').onclick=recent;
 $('csv-file').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{const raw=await file.text(),interval=Number($('csv-interval').value),n=normalize(parseCsv(raw,{timezone:$('csv-timezone').value}),interval,Date.now()/1000);if(n.audit.invalid)throw Error(`유효하지 않거나 미완성인 행 ${n.audit.invalid}개가 있습니다. 조용히 제외하지 않으므로 CSV를 확인해 주세요.`);if(n.bars.length<240)throw Error('완료된 실제 봉이 240개 이상 필요합니다.');if(isSpecial()&&interval!==60)throw Error('지킬·벤팍에는 실제 1분봉 CSV가 필요합니다.');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');datasets.set('csv',{id:'csv-'+hash,label:'가져온 CSV · '+file.name,symbol:'사용자 CSV',provider:'사용자 가져오기',interval,bars:n.bars,audit:n.audit,sourceSha256:hash});if(!$('dataset').querySelector('[value="csv"]'))$('dataset').add(new Option('가져온 실제 CSV','csv'));await selectData('csv');}catch(err){notice(err.message);}finally{e.target.value='';}};
 $('export').onclick=()=>{persist();const payload={version:RULE_VERSION,mode,modeName:MODES.find(m=>m.id===mode).name,options:options(),source:{id:dataset.id,label:dataset.label,provider:dataset.provider,symbol:dataset.symbol,interval:dataset.interval,first:dataset.bars[0].time,last:dataset.bars.at(-1).time,sourceSha256:dataset.sourceSha256||null,fetchedAt:dataset.fetchedAt||null},replayTime:session.cursor,paperOnly:true,broker:session.broker.snapshot()};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`gold-practice-${mode}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}
async function init(){
 bind();charts=makeCharts();const s=window.GOLD_PRACTICE_M1;if(!s){notice('실제 M1 표본을 찾을 수 없습니다. 시세 파일을 확인해 주세요.');return;}
 const n=normalize(s.rows.map(r=>({time:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]})),60);datasets.set('sample',{...s,bars:n.bars,audit:n.audit,rows:undefined});
 try{const key=sessionStorage.getItem('goldTrainingKey');if(key)$('api-key').value=key;const fresh=JSON.parse(sessionStorage.getItem('goldTrainingRecent'));if(fresh?.bars?.length&&fresh.interval===60){datasets.set('recent',fresh);$('dataset').add(new Option('최근 받은 실제 M1','recent'));}}catch{}
 if(window.GOLD_PRACTICE_RECENT?.bars?.length){const verified=window.GOLD_PRACTICE_RECENT,n=normalize(verified.bars.filter(b=>tradableKST(b.time)),60);datasets.set('verified',{...verified,id:verified.id+'-kst',label:'확인된 최근 실제 시세 스냅샷 · 기존 게임 KST 필터',bars:n.bars,upperBars:verified.upperBars.filter(b=>tradableKST(b.time)),audit:n.audit});$('dataset').add(new Option('확인된 최근 실제 M1','verified'));}
 await selectData(datasets.has('verified')?'verified':isSpecial()?'sample':'history');
 if(new URLSearchParams(location.search).get('source')==='recent')await recent();
}
init().catch(e=>notice('연습 화면 초기화: '+e.message));
