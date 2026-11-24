import test from 'node:test';
import assert from 'node:assert/strict';
import {PaperBroker} from '../practice-broker.js';
import {checkGrid,gridPlan,autoTargetAt,AUTO_DEFAULTS} from '../practice-auto.js';

const bar = (time, o, h, l, c) => ({time, open: o, high: h, low: l, close: c, volume: 1});
const auto = (dir, extra = {}) => ({dir, stop: null, target: null, planLots: Array(6).fill(.01), manage: 'auto', grid: {step: 10, maxAdds: 5, buffer: 5}, budgetPct: 10, ...extra});
const closes = b => b.journal.filter(e => e.type === 'close');

test('자동 추가: 10포 불리할 때마다 같은 수량, 최대 5회, 손절 = 마지막 추가 + 여유 5포', () => {
  const b = new PaperBroker({balance: 100000, spread: 0});          // 잔고가 커서 손실 한도보다 포인트 손절이 먼저
  b.plan(auto(1), 0);
  b.process(bar(0, 100, 100.5, 99.5, 100));
  assert.deepEqual(b.position.addLevels, [90, 80, 70, 60, 50]);
  assert.equal(b.position.stop, 45);
  assert.equal(b.position.stopReason, '손절(추가 끝 + 여유)');
  b.process(bar(60, 100, 100, 40, 41));
  const adds = b.journal.filter(e => e.type === 'add');
  assert.deepEqual(adds.map(e => e.price), [90, 80, 70, 60, 50]);
  assert(adds.every(e => e.lots === .01));
  assert.equal(closes(b).at(-1).reason, '손절(추가 끝 + 여유)');
  assert.equal(closes(b).at(-1).price, 45);
});

test('자동 추가: 손실이 잔고 한도(10%)에 닿으면 추가가 남아도 먼저 청산', () => {
  const b = new PaperBroker({balance: 1000, spread: 0});
  b.plan(auto(1), 0);
  b.process(bar(0, 100, 100.5, 99.5, 100));
  b.process(bar(60, 100, 100, 40, 41));
  const c = closes(b).at(-1);
  assert.equal(c.reason, '손실 한도(잔고 10%)');
  assert(Math.abs(c.profit + 100) < 1e-6, String(c.profit));        // 정확히 잔고 10%
  assert.equal(b.journal.filter(e => e.type === 'add').length, 3);
});

test('자동 추가: 매도도 대칭', () => {
  const b = new PaperBroker({balance: 100000, spread: 0});
  b.plan(auto(-1, {grid: {step: 5, maxAdds: 2, buffer: 3}, planLots: Array(3).fill(.01)}), 0);
  b.process(bar(0, 200, 200.5, 199.5, 200));
  assert.deepEqual(b.position.addLevels, [205, 210]);
  assert.equal(b.position.stop, 213);
});

test('자동 익절: 앱이 정한 익절가와 이유로 청산된다', () => {
  const b = new PaperBroker({balance: 1000, spread: 0});
  b.plan(auto(1), 0);
  b.process(bar(0, 100, 100.5, 99.5, 100));
  b.position.target = 104; b.position.targetReason = '익절 · 3분 SMA120';
  b.process(bar(60, 101, 106, 100.5, 105));
  assert.equal(closes(b).at(-1).reason, '익절 · 3분 SMA120');
  assert.equal(closes(b).at(-1).price, 104);
});

test('자동 익절가: 평균가보다 이익인 자리 중 가장 가까운 곳, 직전에 완성된 3분봉·확정 H1만', () => {
  const m3 = [
    {time: 0, end: 180, bb4Up: 130, bb4Low: 70, sma120: 99},
    {time: 180, end: 360, bb4Up: 108, bb4Low: 92, sma120: 103},
    {time: 360, end: 540, bb4Up: 101, bb4Low: 99, sma120: 100},   // 아직 안 끝난 봉 — 쓰면 안 됨
  ];
  const zones = [{end: 300, zones: [{res: true, bot: 105, top: 106, kind: '미국 최고'}, {res: false, bot: 94, top: 95, kind: '낚임'}]}];
  const market = {frames: {m3}, zones};
  const long = {dir: 1, entries: [{price: 100, lots: .01}]};
  assert.deepEqual(autoTargetAt(market, long, 360), {level: 103, source: '3분 SMA120'});
  assert.deepEqual(autoTargetAt(market, long, 360, {band: true, ma: false, zone: true}), {level: 105, source: 'H1 미국 최고 저항'});
  assert.deepEqual(autoTargetAt(market, long, 360, {band: true, ma: false, zone: false}), {level: 108, source: '3분 4·4 밴드'});
  // 평균가보다 아래(손해 쪽)인 이평은 익절이 아니다
  assert.equal(autoTargetAt(market, {dir: 1, entries: [{price: 110, lots: .01}]}, 360, {band: false, ma: true, zone: false}), null);
  const short = {dir: -1, entries: [{price: 100, lots: .01}, {price: 104, lots: .01}]};   // 평균 102
  assert.deepEqual(autoTargetAt(market, short, 360), {level: 95, source: 'H1 낚임 지지'});
  // H1 확정 전(시각 200)에는 매물대를 쓰지 않고, 그때 완성된 첫 3분봉 값 중 가까운 것
  assert.deepEqual(autoTargetAt(market, short, 200), {level: 99, source: '3분 SMA120'});
  assert.deepEqual(autoTargetAt(market, short, 200, {band: true, ma: false, zone: true}), {level: 70, source: '3분 4·4 밴드'});
});

test('자동 설정 값 검사와 미리보기', () => {
  assert.deepEqual(checkGrid({step: 10, maxAdds: 5, buffer: 5, budgetPct: 10}), {step: 10, maxAdds: 5, buffer: 5, budgetPct: 10});
  assert.throws(() => checkGrid({step: 0, maxAdds: 5, buffer: 5, budgetPct: 10}), /간격/);
  assert.throws(() => checkGrid({step: 10, maxAdds: 2.5, buffer: 5, budgetPct: 10}), /횟수/);
  assert.throws(() => checkGrid({step: 10, maxAdds: 5, buffer: -1, budgetPct: 10}), /여유/);
  assert.throws(() => checkGrid({step: 10, maxAdds: 5, buffer: 5, budgetPct: 0}), /손실 한도/);
  assert.deepEqual(gridPlan(1, 3950, AUTO_DEFAULTS), {adds: [3940, 3930, 3920, 3910, 3900], stop: 3895, distance: 55});
  assert.deepEqual(gridPlan(-1, 3950, AUTO_DEFAULTS).stop, 4005);
});
