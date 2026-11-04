/* Real observations only. Times are UTC epoch seconds; bars are open-labelled. */
export const TF = {m1:60,m3:180,m5:300,m10:600,m15:900,m30:1800,h1:3600,h2:7200,h4:14400,d1:86400};
export const TF_LABEL = {m1:'1분',m3:'3분',m5:'5분',m10:'10분',m15:'15분',m30:'30분',h1:'1시간',h2:'2시간',h4:'4시간',d1:'일봉'};
// Retain the original game's live-feed calendar. This is an inherited KST grid,
// not a newly asserted exchange/DST/holiday calendar.
export function tradableKST(time){const d=new Date((time+32400)*1000),day=d.getUTCDay(),hour=d.getUTCHours();return day===6?hour<6:day===0?false:day===1?hour>=7:true;}
export function normalize(rows, interval=60, now=Infinity) {
  const map=new Map(); let invalid=0,duplicates=0;
  for(const raw of rows){
    const b={time:Number(raw.time??raw.t),open:Number(raw.open??raw.o),high:Number(raw.high??raw.h),low:Number(raw.low??raw.l),close:Number(raw.close??raw.c),volume:Number(raw.volume??raw.v??0)};
    if(![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)||b.time%interval!==0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.low>b.high||b.time+interval>now){invalid++;continue;}
    if(map.has(b.time)){const prior=map.get(b.time);if(['open','high','low','close'].some(k=>prior[k]!==b[k]))throw Error('같은 시각에 서로 다른 시세가 있습니다. 중복 행을 확인해 주세요.');duplicates++;}
    map.set(b.time,b);
  }
  const bars=[...map.values()].sort((a,b)=>a.time-b.time);let gaps=0;for(let i=1;i<bars.length;i++)if(bars[i].time-bars[i-1].time>interval)gaps++;
  return {bars,audit:{invalid,duplicates,gaps,interval,count:bars.length}};
}
export function decodeStored(value,kind='m5'){
  const a=value.split(';'),interval=kind==='h1'?3600:Number(a.shift()),base=Number(a.shift());let time=base;
  return a.filter(Boolean).map(row=>{const p=row.split(',').map(Number);time+=p[0]*interval;return {time,open:p[1],high:p[2],low:p[3],close:p[4],volume:p[5]||0};});
}
export function aggregate(bars,baseSeconds,seconds,until=Infinity){
  if(seconds<baseSeconds||seconds%baseSeconds)throw Error('하위 시간봉은 원시 데이터보다 작을 수 없습니다. 1·3분봉에는 실제 1분봉이 필요합니다.');
  const out=[];let group=null;
  for(const b of bars){
    if(b.time+baseSeconds>until)break;
    const offset=seconds>=7200?7200:0; // Original game's KST 07:00 trading-day grid.
    const time=Math.floor((b.time+offset)/seconds)*seconds-offset;
    if(!group||group.time!==time){if(group)finish();group={time,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume||0,count:1,first:b.time,last:b.time};}
    else{group.high=Math.max(group.high,b.high);group.low=Math.min(group.low,b.low);group.close=b.close;group.volume+=b.volume||0;group.count++;group.last=b.time;}
  }
  if(group)finish();return out;
  function finish(){if(group.count===seconds/baseSeconds&&group.first===group.time&&group.last+baseSeconds===group.time+seconds)out.push({...group,end:group.time+seconds,complete:true});}
}
export function upperBound(bars,time,key='end'){let lo=0,hi=bars.length;while(lo<hi){const m=(lo+hi)>>1;if(bars[m][key]<=time)lo=m+1;else hi=m;}return lo;}
export function indicators(bars){
  let sums={20:0,60:0,120:0},openSum=0,openSq=0,closeSq=0,ranges=0;
  return bars.map((b,i)=>{
    const o={...b};for(const n of [20,60,120]){sums[n]+=b.close;if(i>=n)sums[n]-=bars[i-n].close;o['sma'+n]=i>=n-1?sums[n]/n:null;}
    openSum+=b.open;openSq+=b.open*b.open;if(i>=4){openSum-=bars[i-4].open;openSq-=bars[i-4].open**2;}
    closeSq+=b.close*b.close;if(i>=20)closeSq-=bars[i-20].close**2;
    ranges+=b.high-b.low;if(i>=20)ranges-=bars[i-20].high-bars[i-20].low;o.avgRange=i>=19?ranges/20:null;
    if(i>=3){const m=openSum/4,d=Math.sqrt(Math.max(0,openSq/4-m*m))*4;o.bb4Up=m+d;o.bb4Low=m-d;}
    else{o.bb4Up=o.bb4Low=null;}
    if(o.sma20!=null){const d=Math.sqrt(Math.max(0,closeSq/20-o.sma20**2))*2;o.bb20Up=o.sma20+d;o.bb20Low=o.sma20-d;}
    else{o.bb20Up=o.bb20Low=null;}return o;
  });
}
// RFC4180 fields, BOM, CRLF and MT5 tab-separated exports are accepted.
export function parseCsv(text,{timezone='UTC'}={}){
  text=text.replace(/^\uFEFF/,'');const delim=text.split(/\r?\n/,1)[0].includes('\t')?'\t':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<=text.length;i++){const c=text[i]??'\n';if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===delim||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!==delim){if(row.some(Boolean))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}}else cell+=c;}
  if(quoted)throw Error('CSV 따옴표가 닫히지 않았습니다.');if(rows.length<2)throw Error('CSV에 헤더와 시세 행이 필요합니다.');
  const heads=rows.shift().map(x=>x.trim().toLowerCase().replace(/[<>]/g,''));
  const at=(r,name)=>r[heads.indexOf(name)];
  const parsed=rows.map((r,index)=>{
    let dt=at(r,'utc_time')||at(r,'datetime')||at(r,'time')||at(r,'date');
    if(heads.includes('date')&&heads.includes('time')&&!at(r,'utc_time'))dt=at(r,'date')+' '+at(r,'time');
    let time;if(/^\d{10}(\.\d+)?$/.test(dt||''))time=Number(dt);else{let s=String(dt||'').trim().replace(/^(\d{4})\.(\d{2})\.(\d{2})/,'$1-$2-$3').replace(' ','T');if(!/(Z|[+-]\d\d:\d\d)$/.test(s))s+=(at(r,'utc_time')||timezone==='UTC')?'Z':'+09:00';time=Date.parse(s)/1000;}
    if(!Number.isFinite(time))throw Error(`CSV ${index+2}행 시각을 읽을 수 없습니다.`);
    return {time,open:Number(at(r,'open')),high:Number(at(r,'high')),low:Number(at(r,'low')),close:Number(at(r,'close')),volume:Number(at(r,'volume')||at(r,'tickvol')||0)};
  });return parsed;
}
export async function fetchRecent(key,{fetcher=fetch,now=Date.now()/1000}={}){
  if(!key?.trim())throw Error('기존 게임의 11종 연습 버튼으로 들어오거나, 데이터 설정에 API 키를 입력해 주세요.');
  const base='https://api.twelvedata.com/time_series?'+new URLSearchParams({symbol:'XAU/USD',apikey:key.trim(),timezone:'UTC',order:'ASC',format:'JSON'});
  const get=async(interval,outputsize)=>{const response=await fetcher(base+'&'+new URLSearchParams({interval,outputsize:String(outputsize)}));const d=await response.json();if(!response.ok||d.status==='error'||!Array.isArray(d.values))throw Error(d.message||'시세를 받지 못했습니다. 기존 자료는 유지합니다.');return d.values.map(v=>({time:Date.parse(v.datetime.replace(' ','T')+'Z')/1000,open:+v.open,high:+v.high,low:+v.low,close:+v.close,volume:+v.volume||0}));};
  // Sequential to avoid bursts; max 5,000 records per official provider contract.
  const raw=await get('1min',5000);const upper=await get('1h',800);
  const n=normalize(raw.filter(b=>tradableKST(b.time)),60,now),h=normalize(upper.filter(b=>tradableKST(b.time)),3600,now);if(n.bars.length<240)throw Error('완료된 1분봉이 240개 미만입니다. 실제 CSV를 가져오거나 기존 표본으로 연습해 주세요.');
  return {id:'recent-'+n.bars.at(-1).time,label:'Twelve Data 최근 실제 시세',symbol:'XAU/USD',provider:'Twelve Data',interval:60,bars:n.bars,upperBars:h.bars,audit:n.audit,calendar:'기존 게임 KST 거래시간',fetchedAt:new Date(now*1000).toISOString()};
}

const utcParam=time=>new Date(time*1000).toISOString().slice(0,19).replace('T',' ');
export function practiceBounds(data){
  if(!data.bars?.length)throw Error('연습할 실제 시세가 없습니다.');
  return {start:Math.max(data.bars[0].time+data.interval,data.replayStart??-Infinity),end:Math.min(data.bars.at(-1).time+data.interval,data.replayEnd??Infinity)};
}
export function practiceCoverage(data){
  const {end}=practiceBounds(data),start=data.replayStart??data.bars[0].time,bars=data.bars.filter(b=>b.time>=start&&b.time+data.interval<=end);
  return {start,end,first:bars[0]?.time??null,last:bars.at(-1)?.time+data.interval||null,count:bars.length};
}
export function packDataset(data){
  const pack=rows=>rows?.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume||0]);
  return {...data,packing:'ohlcv-v1',bars:pack(data.bars),upperBars:pack(data.upperBars)};
}
export function unpackDataset(data){
  if(!data||data.interval!==60||!Array.isArray(data.bars))throw Error('저장된 M1 자료를 읽을 수 없습니다.');
  if(data.packing!=='ohlcv-v1')return data;
  const unpack=rows=>rows?.map(b=>({time:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]||0}));
  const result={...data,bars:unpack(data.bars),upperBars:unpack(data.upperBars)};delete result.packing;return result;
}
export async function fetchFortnight(key,{fetcher=fetch,now=Date.now()/1000,onProgress=()=>{},signal}={}){
  if(!key?.trim())throw Error('기존 게임의 최근 2주 버튼으로 연결하거나 데이터 설정에 API 키를 입력해 주세요.');
  const end=Math.floor(now/60)*60,start=end-14*86400,warmupStart=start-3*86400,chunkSeconds=3*86400;
  const chunks=[];for(let cursor=warmupStart;cursor<end;cursor+=chunkSeconds)chunks.push({start:cursor,end:Math.min(cursor+chunkSeconds,end)});
  const base='https://api.twelvedata.com/time_series?'+new URLSearchParams({symbol:'XAU/USD',apikey:key.trim(),timezone:'UTC',order:'ASC',format:'JSON'});
  const read=async(interval,outputsize,extra={})=>{
    const response=await fetcher(base+'&'+new URLSearchParams({interval,outputsize:String(outputsize),...extra}),{signal});
    const d=await response.json();
    if(!response.ok||d.status==='error'||!Array.isArray(d.values))throw Error(String(d.message||'시세를 받지 못했습니다.').split(key.trim()).join('[숨김]'));
    return d.values.map(v=>({time:Date.parse(v.datetime.replace(' ','T')+'Z')/1000,open:+v.open,high:+v.high,low:+v.low,close:+v.close,volume:+v.volume||0}));
  };
  const received=[];
  for(let i=0;i<chunks.length;i++){
    const chunk=chunks[i];onProgress({completed:i,total:chunks.length+1,stage:'M1'});
    const rows=await read('1min',5000,{start_date:utcParam(chunk.start),end_date:utcParam(chunk.end-1)});
    const inside=rows.filter(b=>b.time>=chunk.start&&b.time+60<=chunk.end);
    // Empty calendar windows can be closed sessions; never substitute another period.
    // A server ignoring the requested dates is a failed load, not a shorter "two weeks".
    if(rows.length&&!inside.length)throw Error('제공처가 요청한 2주 기간 밖의 자료를 반환했습니다. 기존 연습은 유지합니다.');
    if(!inside.length){for(let t=chunk.start;t<chunk.end;t+=60)if(tradableKST(t))throw Error('최근 2주 중 거래시간 자료가 비어 있는 기간이 있습니다. 짧은 자료로 대체하지 않았습니다.');}
    received.push(...inside);
  }
  onProgress({completed:chunks.length,total:chunks.length+1,stage:'H1'});
  const upper=await read('1h',2000,{end_date:utcParam(end-1)});
  const n=normalize(received.filter(b=>tradableKST(b.time)),60,end),h=normalize(upper.filter(b=>tradableKST(b.time)),3600,end);
  if(n.audit.invalid)throw Error('유효하지 않은 시세 행이 있어 최근 2주 자료를 적용하지 않았습니다.');
  if(h.bars.length<150)throw Error('최근 2주 연습에 필요한 상위봉 준비 자료가 부족합니다. 기존 연습은 유지합니다.');
  const exercise=n.bars.filter(b=>b.time>=start&&b.time+60<=end);
  if(exercise.length<240)throw Error('요청한 최근 2주 기간의 실제 완료 봉이 부족합니다. 기존 연습은 유지합니다.');
  // Boundary gaps are retained as evidence. Holidays/missing quotes are not invented.
  const coverage={requestedStart:start,requestedEnd:end,observedStart:exercise[0].time,observedEnd:exercise.at(-1).time+60,barCount:exercise.length,chunks:chunks.length,requests:chunks.length+1,warmupStart,allChunksFetched:true};
  onProgress({completed:chunks.length+1,total:chunks.length+1,stage:'done'});
  return {id:`fortnight-${start}-${end}`,label:'최신 2주 실제 시세',symbol:'XAU/USD',provider:'Twelve Data',interval:60,bars:n.bars,upperBars:h.bars,audit:n.audit,calendar:'기존 게임 KST 거래시간',windowDays:14,replayStart:start,replayEnd:end,coverage,fetchedAt:new Date(now*1000).toISOString()};
}
