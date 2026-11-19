import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSession,latestSessionDate,sessionWindow,practiceBounds,practiceCoverage,packDataset,unpackDataset,TF} from '../practice-data.js';
import {buildMarket,buildTimeline,assess,MODES} from '../practice-rules.js';
import {PaperBroker} from '../practice-broker.js';

const kst = s => Date.parse(s + '+09:00') / 1000;
const iso = t => new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ');
// 가짜 Twelve Data: 요청한 날짜 범위의 1분봉 / end_date 까지의 H1 (주말·제공처 휴장은 'No data')
function provider(calls, {emptySession = false} = {}) {
  return async url => {
    calls.push(url);
    const p = new URL(url).searchParams, interval = p.get('interval');
    const step = interval === '1h' ? 3600 : 60;
    const end = Date.parse(p.get('end_date').replace(' ', 'T') + 'Z') / 1000;
    const start = p.get('start_date') ? Date.parse(p.get('start_date').replace(' ', 'T') + 'Z') / 1000 : end - (Number(p.get('outputsize')) - 1) * step;
    const values = [];
    for (let t = Math.ceil(start / step) * step; t <= end; t += step) {
      if (emptySession && step === 60 && t >= kst('2026-11-18T07:00:00')) continue;
      const v = 4000 + Math.sin(t / 5400) * 20;
      values.push({datetime: iso(t), open: String(v), high: String(v + 1.5), low: String(v - 1.5), close: String(v + 0.3), volume: '0'});
    }
    if (!values.length) return {ok: false, json: async () => ({status: 'error', code: 400, message: 'No data is available on the specified dates. Try setting different start/end dates.'})};
    return {ok: true, json: async () => ({meta: {}, values})};
  };
}
const proxy = {url: 'https://example.supabase.co/functions/v1/td-proxy', headers: {apikey: 'anon', Authorization: 'Bearer anon'}};

test('하루 장: 가장 최근에 끝난 평일 장(07:00 개장일)을 고른다', () => {
  assert.equal(latestSessionDate(kst('2026-11-19T12:40:00')), '2026-11-18');   // 목 낮 → 수요일 장
  assert.equal(latestSessionDate(kst('2026-11-19T04:59:00')), '2026-11-17');   // 05:00 전 → 수요일 장은 아직
  assert.equal(latestSessionDate(kst('2026-11-19T05:00:00')), '2026-11-18');
  assert.equal(latestSessionDate(kst('2026-11-21T09:00:00')), '2026-11-20');   // 토
  assert.equal(latestSessionDate(kst('2026-11-23T12:00:00')), '2026-11-20');   // 월 낮 → 금요일 장
  const w = sessionWindow('2026-11-18');
  assert.equal(w.open, kst('2026-11-18T07:00:00'));
  assert.equal(w.close, kst('2026-11-19T05:00:00'));
  assert.throws(() => sessionWindow('2026/11/18'), /형식/);
});

test('하루 장 받기: 장 1분봉 + 앞 3일 준비 1분봉 + H1, 장 밖 자료는 쓰지 않는다', async () => {
  const calls = [], progress = [], now = kst('2026-11-19T12:40:00');
  const d = await fetchSession(null, {proxy, date: '2026-11-18', now, fetcher: provider(calls), onProgress: p => progress.push(p)});
  assert.equal(calls.length, 3);
  assert(calls.every(u => u.startsWith(proxy.url + '?') && !u.includes('apikey')));
  const m1 = calls.filter(u => new URL(u).searchParams.get('interval') === '1min').map(u => new URL(u).searchParams);
  assert.deepEqual(m1.map(p => p.get('start_date')), ['2026-11-14 22:00:00', '2026-11-17 22:00:00']);
  assert.deepEqual(m1.map(p => p.get('end_date')), ['2026-11-17 21:59:59', '2026-11-18 19:59:59']);
  assert.equal(new URL(calls[2]).searchParams.get('end_date'), '2026-11-18 19:59:59');
  assert.equal(d.id, 'session-2026-11-18');
  assert.equal(d.sessionDate, '2026-11-18');
  assert.equal(d.replayStart, kst('2026-11-18T07:00:00'));
  assert.equal(d.replayEnd, kst('2026-11-19T05:00:00'));
  assert(d.bars[0].time < d.replayStart, '앞선 준비 자료');
  assert(d.bars.every(b => b.time + 60 <= d.replayEnd), '05:00 이후 없음');
  assert(d.upperBars.every(b => b.time + 3600 <= d.replayEnd));
  assert.equal(practiceBounds(d).start, d.replayStart);
  assert.equal(practiceBounds(d).end, d.replayEnd);
  assert.equal(practiceCoverage(d).count, 22 * 60);
  assert.equal(progress.at(-1).stage, 'done');
  assert.deepEqual(unpackDataset(JSON.parse(JSON.stringify(packDataset(d)))).bars.slice(0, 3), d.bars.slice(0, 3));
  // 그 장으로 모든 연습 시간봉이 만들어진다
  const market = buildMarket(d);
  for (const tf of ['m1', 'm3', 'm5', 'm15', 'h1']) assert(market.frames[tf]?.length, tf);
});

test('하루 장 받기: 주말·끝나지 않은 장·자료 없는 날은 받지 않는다', async () => {
  const now = kst('2026-11-19T12:40:00');
  await assert.rejects(() => fetchSession(null, {proxy, date: '2026-11-15', now, fetcher: provider([])}), /주말/);
  await assert.rejects(() => fetchSession(null, {proxy, date: '2026-11-19', now, fetcher: provider([])}), /끝난 장만/);
  await assert.rejects(() => fetchSession(null, {proxy, date: '2026-11-18', now, fetcher: provider([], {emptySession: true})}), /휴장일이거나/);
  await assert.rejects(() => fetchSession(null, {date: '2026-11-18', now, fetcher: provider([])}), /API 키/);
});

test('자유 매매: 규칙 판정 없이 수동 상태, 진행 봉을 고를 수 있다', () => {
  const m = MODES.find(x => x.id === 'freeplay');
  assert(m && m.name === '자유 매매' && m.tf === 'm5');
  const t = buildTimeline({frames: {m5: [{time: 0, end: 300, open: 1, high: 2, low: 0, close: 1}]}, zones: [], frames2: null}, 'm5', 'freeplay');
  assert.equal(t.length, 1);
  assert.equal(t[0].candidate, null);
  assert.equal(t[0].kind, 'manual');
  assert.equal(assess(t[0]).status, 'manual');
  assert.equal(TF.m1, 60);
});

test('자유 매매: 손절 없이 진입하고 목표나 직접 청산으로만 정리된다', () => {
  const bar = (time, o, h, l, c) => ({time, open: o, high: h, low: l, close: c, volume: 1});
  const b = new PaperBroker({balance: 1000, spread: 0});
  b.plan({dir: -1, stop: null, target: null, planLots: [0.1], manage: 'free'}, 0);
  b.process(bar(0, 100, 130, 90, 120));          // 매도 진입 후 크게 올라도 손절이 없으니 유지
  assert.equal(b.position.dir, -1);
  b.process(bar(60, 120, 125, 70, 80));
  assert.equal(b.position.dir, -1);
  b.close(80, 120);
  assert.equal(b.position, null);
  assert.equal(b.journal.at(-1).profit, (100 - 80) * 0.1 * 100);
  // 목표만 넣으면 목표에서 청산
  b.plan({dir: 1, stop: null, target: 105, planLots: [0.1], manage: 'free'}, 120);
  b.process(bar(120, 100, 101, 60, 100));
  b.process(bar(180, 100, 106, 99, 104));
  assert.equal(b.position, null);
  assert.equal(b.journal.at(-1).reason, '목표');
  // 다른 모드는 여전히 손절이 필요하다
  assert.throws(() => new PaperBroker().plan({dir: 1, stop: null, planLots: [0.1], manage: 'manual'}, 0), /손절/);
});
