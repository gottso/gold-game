import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalize,aggregate,parseCsv,indicators,decodeStored,fetchRecent,tradableKST} from '../practice-data.js';
import {buildMarket,buildTimeline,assess,MODES} from '../practice-rules.js';
import {PaperBroker,positionSummary,splitLots} from '../practice-broker.js';
const b=(time,o=100,h=101,l=99,c=100)=>({time,open:o,high:h,low:l,close:c,volume:1});
const source=()=>{const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../data_practice_m1.js',import.meta.url),'utf8'),context);return JSON.parse(JSON.stringify(context.window.GOLD_PRACTICE_M1));};
const sample=()=>{const s=source();return {...s,bars:s.rows.map(r=>({time:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]})),interval:60};};
test('M3 cannot be fabricated from M5',()=>assert.throws(()=>aggregate([b(0)],300,180),/1·3분봉/));
test('live calendar is the inherited KST weekend filter, not an invented fill',()=>{
 const t=s=>Date.parse(s)/1000;assert(tradableKST(t('2026-10-30T20:59:00Z')));assert(!tradableKST(t('2026-10-30T21:00:00Z')));assert(!tradableKST(t('2026-11-01T21:59:00Z')));assert(tradableKST(t('2026-11-01T22:00:00Z')));
});
test('M3 requires all three observations and never borrows a future minute',()=>{
 const rows=[b(0,100,102,99,101),b(60,101,104,100,103),b(120,103,105,102,104)];
 assert.equal(aggregate(rows,60,180,120).length,0);assert.equal(aggregate([rows[0],rows[2]],60,180).length,0);
 const [x]=aggregate(rows,60,180,180);assert.deepEqual([x.open,x.high,x.low,x.close,x.end],[100,105,99,104,180]);
});
test('H4 boundaries preserve the original KST 07:00 origin',()=>{
 const t=Date.parse('2026-10-19T22:00:00Z')/1000,rows=Array.from({length:240},(_,i)=>b(t+i*60));
 const [x]=aggregate(rows,60,14400);assert.equal(x.time,t);assert.equal(x.end,t+14400);
});
test('invalid, conflicting duplicate, incomplete and future observations are not used silently',()=>{
 assert.throws(()=>normalize([b(0),b(0,100,102,99,101)]),/서로 다른/);
 assert.equal(normalize([b(0),b(60,100,90,99,100)],60).audit.invalid,1);
 assert.equal(normalize([b(0),b(60)],60,90).bars.length,1);
});
test('CSV UTC column wins over local display time; naive KST is explicit',()=>{
 const a=parseCsv('time,utc_time,open,high,low,close\n2026-10-19T13:02:00,2026-10-19T04:02:00,1,2,0,1',{timezone:'KST'});
 assert.equal(a[0].time,Date.parse('2026-10-19T04:02:00Z')/1000);
 const c=parseCsv('date\ttime\topen\thigh\tlow\tclose\n2026.10.19\t13:02:00\t1\t2\t0\t1',{timezone:'KST'});assert.equal(c[0].time,a[0].time);
});
test('stored data decoder uses seconds for M5 and hours for legacy H1',()=>{
 assert.equal(decodeStored('300;0;0,1,2,0,1;1,1,2,0,1')[1].time,300);
 assert.equal(decodeStored('0;0,1,2,0,1;1,1,2,0,1','h1')[1].time,3600);
});
test('real MT5 sample preserves source provenance and only completed M3',()=>{
 const s=sample(),n=normalize(s.bars);assert.equal(n.audit.invalid,0);assert.equal(s.bars.length,4140);assert.equal(s.sourceSha256,'73d64c20b25d7d02d970898b0b1ee5939d4def154d1e2fe6ed0c0b996e50a1ec');assert.equal(aggregate(s.bars,60,180).length,1379);
});
test('future data append leaves every earlier indicator, H1 zone and strategy state unchanged',()=>{
 const all=sample(),time=all.bars[2500].time+60,prefix={...all,bars:all.bars.filter(b=>b.time+60<=time)},a=buildMarket(prefix),z=buildMarket(all);
 assert.deepEqual(a.frames.m3,z.frames.m3.filter(b=>b.end<=time));assert.deepEqual(a.zones,z.zones.filter(b=>b.end<=time));
 for(const mode of MODES){const tf=mode.tf,x=buildTimeline(a,tf,mode.id),y=buildTimeline(z,tf,mode.id).filter(s=>s.time<=time);assert.deepEqual(x,y,mode.id);}
});
test('longer H1 history only warms up before the first complete M1-derived H1',()=>{
 const s=sample(),h=aggregate(s.bars,60,3600),external=h.map(b=>({...b,close:b.close+1,high:b.high+1}));
 const m=buildMarket({...s,upperBars:external});assert.equal(m.frames.h1[0].close,h[0].close);
});
test('sixth mode remains manual even though a legacy code variant exists',()=>{
 const m=buildMarket(sample()),t=buildTimeline(m,'m5','6');assert(t.every(x=>x.kind==='manual'&&!x.candidate));assert.equal(assess(t.at(-1)).status,'manual');
});
test('Jikil upper risk is not an automatic reverse buy order',()=>{
 const base={mode:'jikil',kind:'proposal',candidate:{dir:-1},checks:[],reason:'M3 touch'};
 const a=assess(base,{obstacle:'sell',direction:'up',reaction:'yes',news:'clear'},{experimental:true,jikilType:'trend'});assert.equal(a.status,'blocked');assert.equal(a.candidate.dir,-1);
});
test('source mode stays manual after checked conditions, and unknown news remains manual',()=>{
 const base={mode:'jikil',kind:'manual',candidate:{dir:1},checks:[],reason:'M3 touch'};
 assert.equal(assess(base,{obstacle:'clear',direction:'up',reaction:'yes',news:'clear'},{experimental:false}).status,'manual');
 assert.equal(assess(base,{obstacle:'clear',direction:'up',reaction:'yes'},{experimental:true}).status,'manual');
});
test('manual entry direction still respects a blocking upper rationale without an automatic candidate',()=>{
 const a=assess({mode:'jikil',kind:'manual',candidate:null,checks:[],reason:'manual'},{obstacle:'buy',direction:'down',reaction:'yes',news:'clear'},{intendedDirection:1});assert.equal(a.status,'blocked');
});
test('Benpark rounds a total .05 lot plan to .02/.02/.01 without exceeding it',()=>{
 assert.deepEqual(splitLots(.05),[.02,.02,.01]);assert.throws(()=>splitLots(.02),/최소 수량/);
});
test('paper decisions never fill retroactively at the just-seen close',()=>{
 const p=new PaperBroker({spread:0});p.plan({dir:1,stop:90,target:120,planLots:[.01]},60);p.process(b(0));assert.equal(p.position,null);p.process(b(60,102,103,101,102));assert.equal(positionSummary(p.position).entry0,102);
});
test('gap beyond structural stop cancels a queued plan instead of granting a fictional fill',()=>{
 const p=new PaperBroker({spread:0});p.plan({dir:1,stop:99,target:110,planLots:[.01]},60);p.process(b(60,97,98,96,97));assert.equal(p.position,null);assert.equal(p.pending,null);assert(p.journal.some(e=>e.type==='cancel'));assert.equal(p.balance,1000);
});
test('method 7 second limit expires even after its first limit already filled',()=>{
 const p=new PaperBroker({spread:0});p.plan({dir:1,stop:90,target:110,planLots:[.01,.01],addLevels:[95],limit:100,expires:180},60);p.process(b(60,101,102,99,100));if(p.ambiguity)p.resolve('OLHC');assert.equal(positionSummary(p.position).count,1);p.process(b(180,100,101,94,96));if(p.ambiguity)p.resolve('OLHC');assert.equal(positionSummary(p.position).count,1);
});
test('a stop reached through a gap is filled at the observed open, not the old stop',()=>{
 const p=new PaperBroker({spread:0});p.plan({dir:1,stop:95,target:120,planLots:[.01]},0);p.process(b(0,100,101,99,100));p.process(b(60,90,91,89,90));assert.equal(p.balance,990);assert.equal(p.journal.at(-1).price,90);
});
test('both stop and target in one base candle freezes for an explicit path assumption',()=>{
 const p=new PaperBroker({spread:0});p.plan({dir:1,stop:95,target:105,planLots:[.01]},0);p.process(b(0,100,101,99,100));p.process(b(60,100,106,94,100));assert(p.ambiguity);assert.equal(p.balance,1000);p.resolve('OLHC');assert.equal(p.balance,995);assert.equal(p.assumptions,1);assert.equal(p.ambiguity,null);
});
test('Benpark uses one fixed $100 bundle budget after all three fills',()=>{
 const p=new PaperBroker({balance:1000,spread:0});p.plan({dir:1,stop:null,target:null,planLots:splitLots(.05),manage:'benpark',budgetPct:10},0);p.process(b(0,4320,4321,4319,4320));
 p.process(b(60,4311,4311,4309,4310));if(p.ambiguity)p.resolve('OLHC');p.process(b(120,4301,4301,4299,4300));if(p.ambiguity)p.resolve('OLHC');
 const s=positionSummary(p.position);assert.equal(s.lots,.05);assert.equal(s.average,4312);assert.equal(s.stop,4292);p.process(b(180,4294,4295,4291,4292));if(p.ambiguity)p.resolve('OLHC');assert.equal(p.balance,900);
});
test('Jikil grid stop stays anchored to E0 rather than an improving average',()=>{
 const p=new PaperBroker({spread:0});p.plan({dir:1,planLots:Array(6).fill(.01),manage:'grid',target:null},0);p.process(b(0,4200,4201,4199,4200));p.process(b(60,4191,4191,4189,4190));if(p.ambiguity)p.resolve('OLHC');const s=positionSummary(p.position);assert.equal(s.stop,4145);assert.equal(s.average,4195);assert.equal(s.target,4200);
});
test('spread is charged through entry ask and exit bid exactly once each',()=>{
 const p=new PaperBroker({spread:.4});p.plan({dir:1,stop:90,target:120,planLots:[.01]},0);p.process(b(0,100,101,99,100));p.close(100,60);assert(Math.abs(p.balance-999.6)<1e-8);
});
test('snapshot/restore preserves pending orders, ambiguity and per-mode journals',()=>{
 const p=new PaperBroker({spread:0});p.plan({dir:1,stop:95,target:105,planLots:[.01]},0);p.process(b(0,100,106,94,100));const restored=PaperBroker.restore(p.snapshot());assert.deepEqual(restored.snapshot(),p.snapshot());restored.resolve('OHLC');assert.equal(p.balance,1000);assert.equal(restored.balance,1005);
});
test('recent-data connector caps requests at 5000 and rejects incomplete latest observations',async()=>{
 const calls=[],time=Date.parse('2026-10-20T00:00:00Z')/1000;
 const fetcher=async url=>{calls.push(url);const min=url.includes('interval=1min');const values=Array.from({length:min?300:200},(_,i)=>({datetime:new Date((time+i*(min?60:3600))*1000).toISOString().slice(0,19).replace('T',' '),open:'100',high:'101',low:'99',close:'100'}));return {ok:true,json:async()=>({values})};};
 const d=await fetchRecent('test-not-a-secret',{fetcher,now:time+300*60});assert.equal(d.bars.length,300);assert(calls[0].includes('outputsize=5000'));assert(calls[1].includes('outputsize=800'));assert(d.upperBars.every(b=>b.time+3600<=time+300*60));
});
test('provider failure is surfaced; it never returns generated fallback prices',async()=>{
 await assert.rejects(()=>fetchRecent('test',{fetcher:async()=>({ok:true,json:async()=>({status:'error',message:'limit reached'})})}),/limit reached/);
});
test('H1 zones match independently generated legacy Python reference on real provider data',()=>{
 const c={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../data_practice_recent.js',import.meta.url),'utf8'),c);const d=JSON.parse(JSON.stringify(c.window.GOLD_PRACTICE_RECENT));d.bars=d.bars.filter(b=>tradableKST(b.time));d.upperBars=d.upperBars.filter(b=>tradableKST(b.time));const m=buildMarket(d);
 const ref=JSON.parse(fs.readFileSync(new URL('./fixtures/zones-v16-reference.json',import.meta.url),'utf8'));
 for(const expected of ref){const actual=m.zones.find(x=>x.end===expected.end);assert(actual);assert.equal(actual.zones.length,expected.zones.length,'selected count at '+expected.end);actual.zones.forEach((z,i)=>{const e=expected.zones[i];assert.equal(z.res,e.res);assert.equal(z.kind,e.kind);assert.equal(z.hits,e.hits);assert(Math.abs(z.top-e.top)<1e-6);assert(Math.abs(z.bot-e.bot)<1e-6);});}
});
