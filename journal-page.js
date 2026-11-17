import {getCode,setCode,ping,flush,pendingCount,listTrades,deleteTrade,summarize,groupByMode} from './journal-client.js';
import {MODES} from './practice-rules.js';

const $=id=>document.getElementById(id);
const fmt=(v,n=2)=>v==null||!Number.isFinite(+v)?'—':(+v).toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n});
const money=v=>v==null?'—':(v>=0?'+$':'-$')+fmt(Math.abs(v));
const pct=v=>v==null?'—':(v*100).toFixed(1)+'%';
const kst=iso=>iso?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)):'—';
// 실제로 매매한 순서(기록 시각) 기준. 재생 시장 시각은 연도가 뒤섞이므로 정렬에 쓰지 않는다
const order=(a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.exit_time).localeCompare(String(b.exit_time));
const esc=s=>String(s??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const ORDER=['free',...MODES.map(m=>m.id)];
const LABEL=Object.fromEntries([['free','자유 게임'],...MODES.map(m=>[m.id,(/^\d+$/.test(m.id)?m.id+' · ':'')+m.name])]);
let all=[],shown=100,chart=null,line=null,noticeTimer;

function notice(msg){const n=$('notice');n.textContent=msg;n.classList.add('on');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.classList.remove('on'),3500);}
function codeState(text,cls=''){const c=$('code-state');c.textContent=text;c.className='chip '+cls;}
function queueState(){const n=pendingCount();$('queue-state').textContent=n?`이 기기에 전송 대기 ${n}건.`:'';$('send-now').hidden=!n;}

function filtered(){const src=$('f-source').value,mode=$('f-mode').value;return all.filter(t=>(!src||t.source===src)&&(!mode||(t.source==='free'?'free':t.mode)===mode));}

function renderKpis(list){
 const s=summarize(list),sign=v=>v==null?'':v>=0?'positive':'negative';
 $('k-count').textContent=s.count;$('k-win').textContent=pct(s.winRate);
 $('k-total').textContent=money(s.total);$('k-total').className=sign(s.total);
 $('k-r').textContent=s.avgR==null?'—':(s.avgR>=0?'+':'')+fmt(s.avgR)+'R';$('k-r').className=sign(s.avgR);
 $('k-pf').textContent=s.profitFactor===Infinity?'∞':fmt(s.profitFactor);
 $('k-dd').textContent=s.maxDrawdown?money(s.maxDrawdown):'—';
 const mode=$('f-mode').value,src=$('f-source').value;
 $('kpi-title').textContent=mode?LABEL[mode]||mode:src==='practice'?'11종 연습 요약':src==='free'?'자유 게임 요약':'전체 요약';
}
function renderCurve(list){
 if(!window.LightweightCharts)return;
 if(!chart){const el=$('curve');chart=LightweightCharts.createChart(el,{width:el.clientWidth,height:el.clientHeight,layout:{background:{color:'#161b22'},textColor:'#a3afbf'},grid:{vertLines:{color:'#202833'},horzLines:{color:'#202833'}},rightPriceScale:{borderColor:'#2a3340'},timeScale:{borderColor:'#2a3340',timeVisible:true}});
  line=chart.addBaselineSeries({baseValue:{type:'price',price:0},topLineColor:'#4ed59a',bottomLineColor:'#ff837b',topFillColor1:'rgba(78,213,154,.18)',topFillColor2:'rgba(78,213,154,.02)',bottomFillColor1:'rgba(255,131,123,.02)',bottomFillColor2:'rgba(255,131,123,.18)',lineWidth:2});
  new ResizeObserver(()=>chart.resize(el.clientWidth,el.clientHeight)).observe(el);}
 // 같은 시각 청산이 있어도 순서대로 찍히게 1초씩 밀어 준다
 let eq=0,last=-Infinity;const pts=[];
 for(const t of [...list].sort(order)){let s=Math.floor(Date.parse(t.created_at||t.exit_time)/1000);if(!(s>last))s=last+1;last=s;eq+=+t.pnl||0;pts.push({time:s,value:Math.round(eq*100)/100});}
 line.setData(pts);chart.timeScale().fitContent();
}
function renderModes(){
 const src=$('f-source').value,groups=groupByMode(all.filter(t=>!src||t.source===src)).sort((a,b)=>ORDER.indexOf(a.key)-ORDER.indexOf(b.key));
 $('modes').innerHTML=groups.length?groups.map(g=>{const s=g.stats;return `<tr class="mode-row" data-mode="${esc(g.key)}"><td>${esc(LABEL[g.key]||g.label)}</td><td>${s.count}</td><td>${pct(s.winRate)}</td><td class="${s.total>=0?'positive':'negative'}">${money(s.total)}</td><td>${money(s.average)}</td><td>${s.avgR==null?'—':fmt(s.avgR)+'R'}</td><td>${s.profitFactor===Infinity?'∞':fmt(s.profitFactor)}</td><td>${s.maxLosingStreak}</td></tr>`;}).join(''):'<tr><td class="l" colspan="8">아직 기록이 없습니다. 연습이나 자유 게임에서 진입·청산하면 자동으로 쌓입니다.</td></tr>';
 for(const tr of $('modes').querySelectorAll('.mode-row'))tr.onclick=()=>{$('f-mode').value=tr.dataset.mode;render();window.scrollTo({top:0,behavior:'smooth'});};
}
function renderList(list){
 const rows=[...list].sort(order).reverse();
 $('list-count').textContent=rows.length?`(${rows.length}건)`:'';
 $('trades').innerHTML=rows.slice(0,shown).map(t=>`<tr><td>${kst(t.exit_time)}</td><td class="l">${esc(LABEL[t.source==='free'?'free':t.mode]||t.mode_label||t.mode)}</td><td class="${t.dir>0?'positive':'negative'}">${t.dir>0?'매수':'매도'}</td><td>${fmt(t.lots)}</td><td>${fmt(t.entry_price)}</td><td>${fmt(t.exit_price)}</td><td class="${t.pnl>=0?'positive':'negative'}">${money(+t.pnl)}</td><td>${t.r_multiple==null?'—':fmt(t.r_multiple)}</td><td class="l">${esc(t.exit_reason)}${t.assumption?' · 가정':''}</td><td><button class="del" data-id="${esc(t.id)}">삭제</button></td></tr>`).join('')||'<tr><td class="l" colspan="10">해당하는 거래가 없습니다.</td></tr>';
 $('more').hidden=rows.length<=shown;
 for(const b of $('trades').querySelectorAll('.del'))b.onclick=async()=>{if(!confirm('이 거래 기록을 삭제할까요? 되돌릴 수 없습니다.'))return;try{await deleteTrade(b.dataset.id);all=all.filter(t=>t.id!==b.dataset.id);render();notice('삭제했습니다.');}catch(e){notice('삭제 실패: '+e.message);}};
}
function render(){const list=filtered();renderKpis(list);renderCurve(list);renderModes();renderList(list);}

async function load(){
 if(!getCode()){codeState('코드 미설정');queueState();return;}
 try{await flush();}catch(e){notice('대기 기록 전송 실패: '+e.message);}
 queueState();
 try{all=await listTrades();codeState('연결됨','ok');render();}
 catch(e){codeState(/코드/.test(e.message)?'코드 틀림':'연결 실패','bad');notice(e.message);}
}
function exportCsv(){
 const cols=['exit_time','entry_time','source','mode','mode_label','dataset','dir','lots','entry_price','exit_price','stop','target','pnl','r_multiple','bars_held','adds','exit_reason','assumption'];
 const cell=v=>{const s=v==null?'':String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 const csv=[cols.join(','),...filtered().map(t=>cols.map(c=>cell(t[c])).join(','))].join('\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));a.download=`gold-backtest-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

for(const k of ORDER)$('f-mode').add(new Option(LABEL[k],k));
$('code').value=getCode();
$('save-code').onclick=async()=>{const c=$('code').value.trim();if(c.length<6){notice('기록 코드는 6자 이상이어야 합니다.');return;}
 codeState('확인 중…');try{await ping(c);setCode(c);codeState('연결됨','ok');notice('기록 코드를 이 기기에 저장했습니다.');await load();}catch(e){codeState(/코드/.test(e.message)?'코드 틀림':'연결 실패','bad');notice(e.message);}};
$('forget-code').onclick=()=>{setCode('');$('code').value='';all=[];render();codeState('코드 미설정');notice('이 기기에서 기록 코드를 지웠습니다. 서버 기록은 그대로입니다.');};
$('send-now').onclick=async()=>{try{const r=await flush();notice(`${r.sent}건 전송했습니다.`);}catch(e){notice('전송 실패: '+e.message);}queueState();load();};
$('f-source').onchange=()=>{$('f-mode').value='';render();};
$('f-mode').onchange=render;$('reload').onclick=load;$('csv').onclick=exportCsv;
$('more').onclick=()=>{shown+=100;renderList(filtered());};
render();load();
