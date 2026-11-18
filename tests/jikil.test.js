import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {computeJikil,jikilAt,displayZones,avoidStep,avoidTimeline,formatKSTId,JIKIL_SETTINGS} from '../jikil-v12.js';
import {buildMarket} from '../practice-rules.js';
import {normalize,tradableKST} from '../practice-data.js';

// 손으로 만든 시장: 3분봉(이평 값을 직접 지정) + 준비된 H1 1개 + 준비된 H2 2개(기본비 사건 없음)
const KST10 = Date.parse('2026-11-02T01:00:00Z') / 1000;   // 월요일 10:00 KST (허용시간 안)
function market({start = KST10, m3, zones = [], h1Bar = {}} = {}) {
  const bars = m3.map(([o, h, l, c, s20, s120], i) => ({time: start + i * 180, end: start + (i + 1) * 180, open: o, high: h, low: l, close: c, sma20: s20, sma120: s120}));
  const h1 = [{time: start - 7200, end: start - 3600, open: 100, high: 101, low: 99, close: 100, sma120: 100, avgRange: 5, ...h1Bar}];
  const flat = {open: 100, high: 101, low: 99, close: 100, sma20: 100, sma60: 100, sma120: 100};
  const h2 = [{time: start - 14400, end: start - 7200, ...flat}, {time: start - 7200, end: start, ...flat}];
  return {frames: {m3: bars, h1, h2}, zones: [{end: h1[0].end, zones}]};
}
// 아래→위 교차(2번 봉) 후 4번 봉에서 SMA120(100) 첫 눌림
const BASE = [
  [95, 96, 94, 95, 98, 100],
  [95, 96, 94, 95, 99, 100],
  [101, 103, 100.5, 102, 100.5, 100],   // 교차 매수
  [102, 110, 101, 108, 101, 100],       // 위에서 무장, 교차 후 고점 110
  [104, 105, 99, 103, 101, 100],        // 100 접촉 → 진입, 목표 = 교차 후 고점 110
];
const kinds = r => r.virtualLabels.map(l => l.text.split('\n')[0] + '@' + l.price);

test('지킬 v1.2: 교차 후 첫 SMA120 눌림 진입 → 10포 추가 최대 6회 → 55포 손절', () => {
  const r = computeJikil(market({m3: [...BASE, [95, 96, 89, 90, 101, 100], [85, 86, 44, 46, 101, 100]]}));
  assert.deepEqual(kinds(r), ['진입 #1@100', '추가 #2@90', '추가 #3@80', '추가 #4@70', '추가 #5@60', '추가 #6@50', '손절@45']);
  assert.equal(r.bars[4].levels.target, 110);
  assert.equal(r.bars[4].levels.stop, 45);
  assert.equal(r.bars[5].levels.average, 95);
  assert.equal(r.bars[6].levels, null);
});

test('지킬 v1.2: 목표가 도달은 계획한 목표 가격으로 청산', () => {
  const r = computeJikil(market({m3: [...BASE, [104, 111, 103, 109, 101, 100]]}));
  assert.deepEqual(kinds(r), ['진입 #1@100', '목표 청산@110']);
});

test('지킬 v1.2: 목표는 H1 선택 저항 하단과 교차 후 고점 중 가까운 쪽', () => {
  const zones = [{res: true, top: 108, bot: 106, born: 1, family: 0, kind: '미국 최고'}];
  const r = computeJikil(market({m3: [...BASE, [104, 107, 103, 106.5, 101, 100]], zones}));
  assert.deepEqual(kinds(r), ['진입 #1@100', '목표 청산@106']);
});

test('지킬 v1.2: H1 저항 직접 반응이면 매수 눌림은 차단되고 사유가 남는다', () => {
  const zones = [{res: true, top: 120, bot: 118, born: 1, family: 0, kind: '미국 최고'}];
  const r = computeJikil(market({m3: BASE, zones, h1Bar: {open: 117, high: 119, low: 110, close: 116}}));
  assert.deepEqual(kinds(r), []);
  assert.equal(r.blockedLabels.length, 1);
  assert.equal(r.blockedLabels[0].text, '매수 진입 차단\n② H1 저항 반응');
  assert.equal(r.bars[4].caption, '매수 진입 금지');
  assert.equal(r.bars[4].tint, '242,54,69');
});

test('지킬 v1.2: 허용시간(07~02시 KST) 밖은 양방향 금지·회색, 진입 차단 사유 ③', () => {
  const r = computeJikil(market({start: Date.parse('2026-11-02T18:00:00Z') / 1000, m3: BASE}));   // 03:00 KST
  assert.deepEqual(kinds(r), []);
  assert.equal(r.bars[4].caption, '양방향 진입 금지');
  assert.equal(r.bars[4].tint, '120,123,134');
  assert.match(r.blockedLabels[0].text, /③ 허용시간 밖 · KST/);
});

test('지킬 v1.2: 상위 자료가 준비되지 않으면 진입하지 않고 노란 배경', () => {
  const m = market({m3: BASE});
  m.frames.h1[0].sma120 = null;
  const r = computeJikil(m);
  assert.deepEqual(kinds(r), []);
  assert.equal(r.bars[4].caption, '자료 준비 중');
  assert.equal(r.bars[4].tint, '255,235,59');
});

test('지킬 v1.2: 사유 라벨은 사유가 바뀐 봉에만', () => {
  const zones = [{res: true, top: 120, bot: 118, born: 1, family: 0, kind: '미국 최고'}];
  const m = market({m3: BASE, zones});
  // 3번째 봉 마감부터 새 H1(저항 반응)이 확정된다
  m.frames.h1.push({time: KST10 - 3600, end: KST10 + 540, open: 117, high: 119, low: 110, close: 116, sma120: 100, avgRange: 5});
  m.zones.push({end: KST10 + 540, zones});
  const r = computeJikil(m);
  assert.equal(r.reasonLabels.length, 1);
  assert.equal(r.reasonLabels[0].time, KST10 + 360);
  assert.equal(r.reasonLabels[0].text, '매수 진입 금지\n② H1 저항 반응');
});

test('지킬 v1.2 기본비 상태: 새 사건만 방향을 만들고, 기울기 무효화로 0이 된다', () => {
  assert.deepEqual(avoidStep(0, -1, -1, 10, true, false, false, false), [1, 10, -1]);
  assert.deepEqual(avoidStep(1, 10, -1, 10, true, false, false, false), [1, 10, -1]);
  assert.deepEqual(avoidStep(1, 10, -1, 11, false, false, true, false), [0, 10, -1]);
  assert.deepEqual(avoidStep(0, 10, -1, 12, false, true, false, false), [-1, 10, 12]);
  assert.deepEqual(avoidStep(0, -1, -1, 13, true, false, true, false), [0, 13, -1]);
});

test('지킬 v1.2 H2: 정배열 + 새 하단 밴드 접촉 = 매수 기본비, SMA20 하락으로 해제', () => {
  const bar = (i, low, s20) => ({time: i * 7200, end: (i + 1) * 7200, open: 110, high: 112, low, close: 111, sma20: s20, sma60: 105, sma120: 100, bb20Low: 108, bb4Low: 107, bb20Up: 120, bb4Up: 121});
  const t = avoidTimeline([bar(0, 109, 109), bar(1, 107.5, 110), bar(2, 109, 111), bar(3, 109, 110.5)]);
  assert.deepEqual(t.map(x => x.dir), [0, 1, 1, 0]);
  assert.equal(t[0].ready, false);
});

test('지킬 v1.2 간단 보기: 같은 역할 겹침은 최신만, 지지·저항 각각 가까운 4개', () => {
  const z = (res, bot, top, born) => ({res, bot, top, born});
  const older = z(false, 90, 95, 1), newer = z(false, 93, 97, 2);
  assert.deepEqual(displayZones([older, newer], 100), [newer]);
  const rs = [z(true, 101, 102, 1), z(true, 103, 104, 2), z(true, 105, 106, 3), z(true, 107, 108, 4), z(true, 107, 108.5, 3.5), z(true, 120, 121, 6)];
  // 107~108 과 107~108.5 는 겹쳐서 최신(born 4)만 남는다 → 4개
  assert.deepEqual(displayZones(rs, 100).map(x => x.bot), [101, 103, 105, 107]);
  // 지지와 저항은 따로 센다: 저항 4 + 지지 2
  const both = [z(true, 101, 102, 1), z(true, 103, 104, 2), z(true, 105, 106, 3), z(true, 107, 108, 4), z(true, 109, 110, 5), z(false, 93, 94, 5), z(false, 80, 81, 6)];
  assert.equal(displayZones(both, 100).length, 6);
});

test('지킬 v1.2: 재생 시각 이후 사건은 보이지 않는다', () => {
  const r = computeJikil(market({m3: [...BASE, [95, 96, 89, 90, 101, 100], [85, 86, 44, 46, 101, 100]]}));
  assert.equal(jikilAt(r, KST10 + 4 * 180).virtualLabels.length, 0);
  assert.equal(jikilAt(r, KST10 + 5 * 180).virtualLabels.length, 1);
  assert.equal(jikilAt(r, KST10 + 7 * 180).virtualLabels.length, 7);
  assert.equal(jikilAt(r, KST10 + 5 * 180).bars.length, 5);
});

test('지킬 v1.2: 확인된 실제 M1 스냅샷에서 돌아가고 박스는 지지·저항 각 4개 이하', () => {
  const c = {window: {}};
  vm.runInNewContext(fs.readFileSync(new URL('../data_practice_recent.js', import.meta.url), 'utf8'), c);
  const v = JSON.parse(JSON.stringify(c.window.GOLD_PRACTICE_RECENT)), n = normalize(v.bars.filter(b => tradableKST(b.time)), 60);
  const m = buildMarket({...v, bars: n.bars, upperBars: v.upperBars.filter(b => tradableKST(b.time))});
  const r = computeJikil(m);
  assert.equal(r.bars.length, m.frames.m3.length);
  for (let i = 0; i < r.bars.length; i += 40) {
    const at = jikilAt(r, r.bars[i].end);
    assert(at.boxes.filter(z => z.res).length <= JIKIL_SETTINGS.perSide && at.boxes.filter(z => !z.res).length <= JIKIL_SETTINGS.perSide);
    assert(at.lastClosedTime <= r.bars[i].end);
  }
  for (const l of r.virtualLabels) assert(Number.isFinite(l.price));
});

test('지킬 v1.2: 기준봉 ID는 KST yyMMddHH', () => {
  assert.equal(formatKSTId(Date.parse('2026-11-02T13:00:00Z') / 1000), '26110222');
});
