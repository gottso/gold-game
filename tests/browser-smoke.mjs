import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),origin='https://gold-practice.test';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1040},ignoreHTTPSErrors:true});
const errors=[],checks=[];await fs.mkdir(path.join(root,'.local'),{recursive:true});
await context.route(origin+'/**',async route=>{
 const name=decodeURIComponent(new URL(route.request().url()).pathname).slice(1)||'practice.html';if(name.includes('..'))return route.abort();
 try{const body=await fs.readFile(path.join(root,name));await route.fulfill({status:200,contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body});}catch{await route.fulfill({status:404,body:'not found'});}
});
// All pages are local workspace assets. No scoreboard submissions or provider credits are used here.
await context.route('https://unpkg.com/lightweight-charts@4.1.1/**',route=>route.fulfill({contentType:'application/javascript',path:path.join(root,'vendor/lightweight-charts-4.1.1.js')}));
await context.route('https://*.supabase.co/**',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const ready=async()=>page.waitForFunction(()=>document.querySelector('#clock')?.textContent.length>5);
const check=(name,fn)=>{assert(fn,name);checks.push(name);};
try{
 await page.goto(origin+'/practice.html');await ready();check('eleven selectable modes',await page.locator('#mode option').count()===11);check('verified actual data default',(await page.locator('#source-info').innerText()).includes('Twelve Data'));
 for(const id of ['1','2','3','4','5','6','7','8','9','jikil','benpark']){
  await page.selectOption('#mode',id);const before=await page.locator('#clock').innerText();await page.locator('#wait').click();await page.locator('#next').click();const after=await page.locator('#clock').innerText();check('replay progresses in mode '+id,before!==after);check('right signal timeframe '+id,await page.locator('#step-tf').inputValue()===(id==='jikil'?'m3':id==='benpark'?'m1':'h1'));
 }
 await page.selectOption('#mode','6');check('sixth mode ungraded',(await page.locator('#assessment').innerText()).includes('자동 정답 판정 없음'));
 await page.selectOption('#mode','jikil');await page.selectOption('#lesson','test');await page.locator('#next').click();check('exam hides rationale',(await page.locator('#assessment').innerText()).includes('직접 판단'));await page.locator('#wait').click();check('exam reveals after decision',!(await page.locator('#assessment').innerText()).includes('직접 판단해 보세요'));
 await page.selectOption('#lesson','learn');await page.selectOption('#mode','benpark');const px=Number((await page.locator('#current-price').innerText()).replaceAll(',',''));await page.locator('#target').fill(String(px+30));await page.locator('#buy').click();check('paper order queued',(await page.locator('#position').innerText()).includes('체결 대기'));await page.locator('#next').click();check('first Benpark slice is .02 lot',(await page.locator('#position').innerText()).includes('0.02랏'));
 const pos=await page.locator('#position').innerText();await page.selectOption('#mode','6');check('accounts independent',(await page.locator('#position').innerText()).includes('보유·예약 없음'));await page.selectOption('#mode','benpark');check('mode account restores',await page.locator('#position').innerText()===pos);await page.reload();await ready();await page.selectOption('#mode','benpark');check('reload restores paper position',(await page.locator('#position').innerText()).includes('0.02랏'));
 await page.evaluate(()=>{window.exportBlob=null;URL.createObjectURL=blob=>{window.exportBlob=blob;return 'blob:test-export';};document.addEventListener('click',e=>{if(e.target instanceof HTMLAnchorElement&&e.target.download)e.preventDefault();},true);});await page.locator('#export').click();const exported=await page.evaluate(async()=>JSON.parse(await window.exportBlob.text()));check('export includes source and decisions',exported.mode==='benpark'&&exported.source.provider==='Twelve Data'&&exported.broker.journal.some(x=>x.type==='decision'));check('export excludes credentials',!JSON.stringify(exported).includes('apikey')&&!('apiKey' in exported));
 await page.locator('#close').click();
 const c={window:{}};vm.runInNewContext(await fs.readFile(path.join(root,'data_practice_m1.js'),'utf8'),c);const csv='utc_time,open,high,low,close,volume\n'+c.window.GOLD_PRACTICE_M1.rows.map(r=>[new Date(r[0]*1000).toISOString(),...r.slice(1)].join(',')).join('\n');
 await page.locator('#csv-file').setInputFiles({name:'actual-m1.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForFunction(()=>document.querySelector('#source-info').textContent.includes('actual-m1.csv'));check('actual CSV import works',(await page.locator('#source-info').innerText()).includes('4,140봉'));
 await page.selectOption('#mode','jikil');await page.selectOption('#dataset','history');await page.waitForFunction(()=>document.querySelector('#dataset').value==='sample');check('M5 never becomes synthetic M3',await page.locator('#dataset').inputValue()==='sample');
 await page.selectOption('#dataset','verified');await page.selectOption('#mode','1');await page.setViewportSize({width:1440,height:1040});await page.screenshot({path:path.join(root,'.local','practice-desktop.png'),fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);const sizes=await page.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));check('no mobile overflow '+width,sizes.w===sizes.s);}
 await page.screenshot({path:path.join(root,'.local','practice-mobile.png'),fullPage:true});
 await context.route('https://api.twelvedata.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'error',message:'Browser smoke: provider unavailable'})}));
 await page.goto(origin+'/index.html?seed=42');await page.waitForSelector('#btnPractice');await page.waitForTimeout(200);check('legacy game training link exists',await page.locator('#btnPractice').getAttribute('href')==='practice.html?source=recent');await page.locator('#btnPractice').click();await ready();check('existing connection passed within session',Boolean(await page.locator('#api-key').inputValue()));await page.waitForFunction(()=>!document.querySelector('#recent').disabled);check('provider failure preserves actual snapshot',(await page.locator('#source-info').innerText()).includes('Twelve Data'));check('no browser exceptions',errors.length===0);
 const report={passed:checks.length,checks,errors,scope:'Local source routed into Chromium; no live provider claim from this test.'};await fs.writeFile(path.join(root,'.local','browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
