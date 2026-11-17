import test from 'node:test';
import assert from 'node:assert/strict';

// 브라우저 localStorage 대역
const mem=new Map();
globalThis.localStorage={getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};

const {practiceTrades,freeTrade,enqueue,flush,pendingCount,setCode,summarize,groupByMode}=await import('../journal-client.js');
const {visibleSpan,normalizeBoxes}=await import('../tv-boxes.js');
const {PaperBroker}=await import('../practice-broker.js');
const bar=(time,o,h,l,c)=>({time,open:o,high:h,low:l,close:c,volume:1});
const ctx={runId:'run-x',mode:'2',modeLabel:'추세지속 기본비 눌림',dataset:'verified',stepTf:'h1',stepSec:3600,lesson:'learn',variant:'code'};

test('practice close becomes one record with dollar P&L and R from the planned stop',()=>{
 const p=new PaperBroker({balance:1000,spread:0});
 p.plan({dir:1,stop:95,target:110,planLots:[.01]},0);
 p.process(bar(3600,100,101,99,100));          // 다음 봉 시가 100 체결
 p.process(bar(7200,100,111,99,110));          // 목표 110 도달
 const [t]=practiceTrades(p.journal,ctx);
 assert.equal(t.dir,1);assert.equal(t.entry_price,100);assert.equal(t.exit_price,110);
 assert.equal(t.pnl,10);assert.equal(t.r_multiple,2);assert.equal(t.bars_held,1);assert.equal(t.exit_reason,'목표');
 assert.equal(t.client_id,'p:run-x:'+p.journal.findIndex(e=>e.type==='close'));
});
test('scanning the same journal again yields identical ids, so nothing is recorded twice',()=>{
 const p=new PaperBroker({balance:1000,spread:0});
 p.plan({dir:-1,stop:105,planLots:[.02]},0);p.process(bar(60,100,100,100,100));p.process(bar(120,100,106,99,104));
 const a=practiceTrades(p.journal,ctx).map(t=>t.client_id),b2=practiceTrades(structuredClone(p.journal),ctx).map(t=>t.client_id);
 assert.deepEqual(a,b2);assert.equal(a.length,1);
 const [t]=practiceTrades(p.journal,ctx);assert.equal(t.pnl,-10);assert.equal(t.r_multiple,-1);assert.equal(t.exit_reason,'손절');
});
test('scaled-in Benpark bundle counts its adds and keeps the bundle P&L',()=>{
 const p=new PaperBroker({balance:1000,spread:0});
 p.plan({dir:1,planLots:[.02,.02,.01],manage:'benpark',budgetPct:10},0);
 p.process(bar(60,100,100,100,100));p.process(bar(120,100,100,79,90));p.process(bar(180,90,130,90,120));
 p.close(120,240);
 const [t]=practiceTrades(p.journal,ctx);
 assert.equal(t.adds,2);assert.equal(t.lots,.05);assert.equal(t.r_multiple,null);
 assert(Math.abs(t.pnl-p.journal.find(e=>e.type==='close').profit)<.01);
});
test('broker run id survives snapshot and restore',()=>{
 const p=new PaperBroker();p.runId='run-keep';assert.equal(PaperBroker.restore(p.snapshot()).runId,'run-keep');
});
test('free-game record uses the same P&L formula as the game',()=>{
 const t=freeTrade({id:7,dir:-1,entry:2000,lots:.1},{runId:'free:h:1:a',exitPrice:1990,entryTime:1,exitTime:2,reason:'수동 청산',barsHeld:3,dataset:'history-h1'});
 assert.equal(t.pnl,100);assert.equal(t.client_id,'free:h:1:a'.replace(/^/,'f:')+':7');assert.equal(t.r_multiple,null);
});
test('offline queue keeps trades without a code and sends each once when a code exists',async()=>{
 mem.clear();setCode('');
 assert.equal(enqueue([{client_id:'a',pnl:1},{client_id:'a',pnl:1},{client_id:'b',pnl:2}]),2);
 assert.deepEqual(await flush(),{sent:0,left:2,reason:'no-code'});
 setCode('secret-code');const calls=[];
 const ok=async(url,init)=>{calls.push({url,init});const ids=JSON.parse(init.body).trades.map(t=>t.client_id);return {ok:true,json:async()=>({saved:ids.length,accepted:ids})};};
 assert.deepEqual(await flush({fetcher:ok}),{sent:2,left:0});
 assert.equal(calls[0].init.headers['x-journal-code'],'secret-code');assert.equal(pendingCount(),0);
 assert.equal(enqueue([{client_id:'a',pnl:1}]),0,'이미 보낸 기록은 다시 넣지 않는다');
});
test('server failure leaves the queue intact for a later retry',async()=>{
 mem.clear();setCode('secret-code');enqueue([{client_id:'c',pnl:1}]);
 await assert.rejects(()=>flush({fetcher:async()=>({ok:false,status:401,json:async()=>({error:'기록 코드가 맞지 않습니다.'})})}),/기록 코드/);
 assert.equal(pendingCount(),1);
});
test('summary statistics: win rate, profit factor, drawdown, losing streak, average R',()=>{
 const t=(pnl,r,i)=>({pnl,r_multiple:r,exit_time:'2026-11-0'+i+'T00:00:00Z',source:'practice',mode:'1'});
 const s=summarize([t(30,1.5,1),t(-10,-1,2),t(-10,-1,3),t(20,null,4)]);
 assert.equal(s.count,4);assert.equal(s.winRate,.5);assert.equal(s.total,30);assert.equal(s.profitFactor,2.5);
 assert.equal(s.maxDrawdown,-20);assert.equal(s.maxLosingStreak,2);assert.equal(s.avgR,-.17);assert.equal(s.rCount,3);
 assert.deepEqual(groupByMode([t(1,null,1),{...t(2,null,2),source:'free',mode:'free'}]).map(g=>g.key).sort(),['1','free']);
});
test('TradingView box is hidden before it starts and clipped at the replay time',()=>{
 const [box]=normalizeBoxes([{id:'x',top:2010,bottom:2000,t1:'2026-11-10T00:00:00Z',t2:'2026-11-12T00:00:00Z',extend_right:false}]);
 const t1=Date.parse('2026-11-10T00:00:00Z')/1000;
 assert.equal(visibleSpan(box,t1),null);
 assert.deepEqual(visibleSpan(box,t1+3600),{left:t1,right:t1+3600});
 assert.equal(visibleSpan(box,t1+10*86400).right,t1+2*86400);
 assert.equal(visibleSpan({...box,extendRight:true},t1+10*86400).right,t1+10*86400);
});
