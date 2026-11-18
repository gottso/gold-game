/* MPL-2.0. 지킬 v1.2 (TradingView "지킬 v1.2 · H1 원본 박스 · 굵은 이평 · 차단 사유", JMbox12, 1102줄) 이식.
 * 11종 연습의 '지킬 3분봉' 차트 표시 전용이다. 주문·채점에는 쓰지 않는다.
 *
 * - H1 구역 인식·반응·선택은 이미 이식된 v16 엔진(practice-zones.js, market.zones)을 그대로 쓴다.
 *   이 파일은 그 위의 원본 '간단 보기'(같은 역할 겹침은 최신만, 지지·저항 각 가까운 4개)를 옮긴다.
 * - 금지 구간: ① H2 기본비 방향(확정 H2마다 1회 처리) ① H2 장기선 반응 보조식 ② H1 지지·저항 직접 반응
 *   ③ 허용시간 07:00~02:00 KST 밖. ④ 발표 시간·② 수동 전고저·수동 방향은 원본 기본값(미입력/양방향)이다.
 * - 가상 진입·추가·청산: 3분봉 OHLC를 O-H-L-C 순서로 따라가며 원본 segment() 사건 순서를 그대로 계산한다.
 *   골드 M3 프로필: 추가 간격 10, 역행 범위 50(최대 6회), 손절 55, 목표는 H1 선택 구역 또는 교차 후 극값 중 가까운 것.
 * - 과거 봉만 쓴다: M3 봉의 H1 상태는 그 봉 마감 시각까지 끝난 H1, H2 상태는 그 봉 시작 전까지 끝난 H2다.
 * TradingView 실행 결과와 완전히 같다고 주장하지 않는다(데이터 제공처·H2 봉 정렬·호가 단위 차이).
 */
import {upperBound} from './practice-data.js';
import {rejection} from './practice-zones.js';

export const JIKIL_SETTINGS = Object.freeze({
  perSide: 4,                   // 간단 보기 · 지지/저항 각각 표시 수
  sessionStart: 7 * 60,         // 신규/추가 허용 07:00 KST
  sessionEnd: 2 * 60,           //               ~ 02:00 KST
  gridStep: 10,                 // 골드 M3 추가 간격
  adverseRange: 50,             // 역행 허용 범위 → 최대 6회
  stopDistance: 55,             // 최초가 기준 손절 거리
  tick: 0.01,
  reasonKeep: 30,               // 사유·차단 라벨 보관 수
  virtualKeep: 100,             // 가상 라벨 보관 수
});
const S = JIKIL_SETTINGS;
const EPS = S.tick * 0.0001;
const MAX_LEGS = Math.floor(S.adverseRange / S.gridStep) + 1;
const finite = Number.isFinite;

export const JIKIL_COLORS = Object.freeze({
  support: '#089981', resistance: '#9c27b0',
  ma20: 'rgb(0,110,190)', ma120: 'rgb(210,140,0)',
  tint: { news: '156,39,176', session: '120,123,134', notReady: '255,235,59', both: '255,152,0', long: '242,54,69', short: '8,153,129' },
  label: { notReady: 'rgb(165,130,0)', news: '#9c27b0', session: '#787b86', both: '#ff9800', long: '#f23645', short: '#089981' },
});

const distance = (price, z) => price > z.top ? price - z.top : price < z.bot ? z.bot - price : 0;

// 원본 '간단' 보기: 같은 역할로 겹치면 최신 기준봉만, 그중 현재 확정 종가에 가까운 순서로 지지·저항 각 perSide개(거리 동률은 함께)
export function displayZones(selected, price, perSide = S.perSide) {
  if (!finite(price)) return [];
  const pool = selected.filter(z => !selected.some(o => o !== z && o.res === z.res && o.born > z.born && Math.min(z.top, o.top) > Math.max(z.bot, o.bot)));
  const sorted = res => pool.filter(z => z.res === res).map(z => distance(price, z)).sort((a, b) => a - b);
  const sup = sorted(false), resist = sorted(true);
  return pool.filter(z => {
    const list = z.res ? resist : sup, d = distance(price, z);
    let nearer = 0;
    while (nearer < list.length && list[nearer] < d) nearer++;
    return nearer < perSide;
  });
}

const inSessionKST = t => { const m = Math.floor((((t + 32400) % 86400) + 86400) % 86400 / 60); return m >= S.sessionStart || m < S.sessionEnd; };

// 원본 fAvoidStep: 같은 원천 봉의 매수·매도 사건은 한 번만, 기울기 회복이 옛 사건을 되살리지 않는다
export function avoidStep(direction, buySeen, sellSeen, eventId, buy, sell, invalidateBuy, invalidateSell) {
  let next = direction;
  const freshBuy = buy && eventId !== buySeen, freshSell = sell && eventId !== sellSeen;
  const nextBuySeen = buy ? eventId : buySeen, nextSellSeen = sell ? eventId : sellSeen;
  if ((next === 1 && (invalidateBuy || sell)) || (next === -1 && (invalidateSell || buy))) next = 0;
  if (freshBuy && !invalidateBuy && !sell) next = 1;
  else if (freshSell && !invalidateSell && !buy) next = -1;
  return [next, nextBuySeen, nextSellSeen];
}

// H2 확정봉마다: 기본비 사건·장기선 반응·준비 여부와 그 봉까지 처리한 방향
export function avoidTimeline(h2) {
  const out = [];
  let dir = 0, buySeen = -1, sellSeen = -1;
  const lowerTouch = b => (finite(b.bb20Low) && b.low <= b.bb20Low) || (finite(b.bb4Low) && b.low <= b.bb4Low);
  const upperTouch = b => (finite(b.bb20Up) && b.high >= b.bb20Up) || (finite(b.bb4Up) && b.high >= b.bb4Up);
  for (let j = 0; j < h2.length; j++) {
    const b = h2[j], p = h2[j - 1];
    const a20 = b.sma20, a60 = b.sma60, a120 = b.sma120, a20Prev = p ? p.sma20 : null;
    const bull = finite(a120) && a20 > a60 && a60 > a120, bear = finite(a120) && a20 < a60 && a60 < a120;
    const buy = bull && lowerTouch(b) && !(p && lowerTouch(p));
    const sell = bear && upperTouch(b) && !(p && upperTouch(p));
    const t120 = finite(a120) && b.low <= a120 && b.high >= a120;
    const maSupport = t120 && b.open > a120 && b.close > a120;
    const maResistance = t120 && b.open < a120 && b.close < a120;
    const ready = finite(a120) && finite(a20Prev);
    if (ready) {
      [dir, buySeen, sellSeen] = avoidStep(dir, buySeen, sellSeen, b.time, buy, sell,
        a20 < a20Prev || (a20 < a60 && a60 < a120),
        a20 > a20Prev || (a20 > a60 && a60 > a120));
    }
    out.push({ time: b.time, end: b.end, ready, dir, buy, sell, maSupport, maResistance });
  }
  return out;
}

function reasonsFor(d, c) {
  const lines = [];
  if (d === 1 ? c.basicBuy : c.basicSell) lines.push('① H2 ' + (d === 1 ? '매도 기본비' : '매수 기본비'));
  if (d === 1 ? c.maBuy : c.maSell) lines.push('① H2 ' + (d === 1 ? '장기선 저항' : '장기선 지지') + '(보조식)');
  if (d === 1 ? c.zoneBuy : c.zoneSell) lines.push('② H1 ' + (d === 1 ? '저항' : '지지') + ' 반응');
  if (!c.inSession) lines.push('③ 허용시간 밖 · KST');
  if (!c.contextReady) lines.push('상위 자료 준비 중');
  return lines.join('\n');
}

// market = practice-rules.js buildMarket() 결과. frames.m3 가 없으면 null.
export function computeJikil(market) {
  const m3 = market?.frames?.m3, h1 = market?.frames?.h1 || [], h2 = market?.frames?.h2 || [], zones = market?.zones || [];
  if (!m3?.length) return null;
  const av = avoidTimeline(h2);
  const bars = [], reasonLabels = [], blockedLabels = [], virtualLabels = [];
  const s = { direction: 0, entry: NaN, stop: NaN, target: NaN, priceSum: 0, legs: 0, opposite: false, cycleDirection: 0,
    armed: false, used: true, impulseHigh: NaN, impulseLow: NaN, exitBar: -1, entries: 0, exits: 0 };
  let prevBuyWhy = null, prevSellWhy = null;

  for (let i = 0; i < m3.length; i++) {
    const b = m3[i], p = m3[i - 1];
    // H1: 이 3분봉 마감까지 끝난 마지막 H1과 그 시점의 v16 선택 구역
    const k = upperBound(h1, b.end) - 1, h = k >= 0 ? h1[k] : null, snap = k >= 0 ? zones[k] : null;
    const selected = snap && snap.end === h.end ? snap.zones : [];
    const h1Ready = !!h && finite(h.sma120) && finite(h.avgRange);
    const zoneSell = !!h && selected.some(z => !z.res && rejection(z, h));   // 지지 반응 → 매도 차단
    const zoneBuy = !!h && selected.some(z => z.res && rejection(z, h));     // 저항 반응 → 매수 차단
    // H2: 이 3분봉 시작 전에 끝난 마지막 H2
    const j = upperBound(h2, b.time) - 1, a = j >= 0 ? av[j] : null;
    const acReady = !!a?.ready, dir = a ? a.dir : 0;
    const c = {
      basicBuy: dir === -1, basicSell: dir === 1,
      maBuy: !!a?.maResistance, maSell: !!a?.maSupport,
      zoneBuy, zoneSell, inSession: inSessionKST(b.time), contextReady: h1Ready && acReady,
    };
    const blockBuy = c.zoneBuy || c.basicBuy || c.maBuy, blockSell = c.zoneSell || c.basicSell || c.maSell;
    const avoidLong = blockBuy || !c.inSession || !c.contextReady, avoidShort = blockSell || !c.inSession || !c.contextReady;
    const buyWhy = reasonsFor(1, c), sellWhy = reasonsFor(-1, c);
    const caption = !c.contextReady ? '자료 준비 중' : avoidLong && avoidShort ? '양방향 진입 금지' : avoidLong ? '매수 진입 금지' : avoidShort ? '매도 진입 금지' : '감지된 차단 없음';
    const explanation = avoidLong && avoidShort
      ? '매수: ' + buyWhy.replaceAll('\n', ' · ') + '\n매도: ' + sellWhy.replaceAll('\n', ' · ')
      : avoidLong ? buyWhy : sellWhy;
    const T = JIKIL_COLORS.tint, L = JIKIL_COLORS.label;
    const tint = !c.inSession ? T.session : !c.contextReady ? T.notReady : avoidLong && avoidShort ? T.both : avoidLong ? T.long : avoidShort ? T.short : null;
    const labelColor = !c.contextReady ? L.notReady : !c.inSession ? L.session : avoidLong && avoidShort ? L.both : avoidLong ? L.long : L.short;
    if (prevBuyWhy !== null && (buyWhy !== prevBuyWhy || sellWhy !== prevSellWhy) && (avoidLong || avoidShort))
      reasonLabels.push({ i, time: b.time, end: b.end, price: b.high, text: caption + '\n' + explanation, color: labelColor });
    prevBuyWhy = buyWhy; prevSellWhy = sellWhy;

    // ---- 가상 진입·추가·청산 (원본 SignalState.segment) ----
    const touchMA = p ? p.sma120 : null;
    const alignment = p && finite(p.sma20) && finite(p.sma120) ? Math.sign(p.sma20 - p.sma120) : 0;
    const allowed = d => c.inSession && c.contextReady && !(d === 1 ? blockBuy : blockSell);
    const emit = (kind, price, d, leg) => {
      if (kind === '차단') {
        const why = reasonsFor(d, c);
        if (why) blockedLabels.push({ i, time: b.time, end: b.end, price, d, text: (d === 1 ? '매수' : '매도') + ' 진입 차단\n' + why });
        return;
      }
      virtualLabels.push({ i, time: b.time, end: b.end, price, d, kind, text: kind + (leg > 0 ? ' #' + leg : '') + '\n' + price.toFixed(2) });
    };
    const fLimit = (cur, dest, level, trigger) => {
      if (!finite(level)) return NaN;
      if (trigger * (cur - level) >= -EPS) return cur;
      return level >= Math.min(cur, dest) && level <= Math.max(cur, dest) ? level : NaN;
    };
    const fTouch = (cur, dest, level) => {
      if (!finite(level)) return NaN;
      const r = dest >= cur ? Math.ceil(level / S.tick - 1e-6) / (1 / S.tick) : Math.floor(level / S.tick + 1e-6) / (1 / S.tick);
      return r >= Math.min(cur, dest) && r <= Math.max(cur, dest) ? r : NaN;
    };
    const fTarget = (d, e, impulse) => {
      let result = finite(impulse) && d * (impulse - e) >= S.tick ? impulse : NaN;
      for (const z of selected) {
        if (z.res !== (d === 1)) continue;
        const level = d === 1 ? z.bot : z.top;
        if (d * (level - e) >= S.tick && (!finite(result) || Math.abs(level - e) < Math.abs(result - e))) result = level;
      }
      return result;
    };
    const resetPosition = () => { s.direction = 0; s.legs = 0; s.priceSum = 0; s.opposite = false; s.entry = s.stop = s.target = NaN; s.exitBar = i; };
    const segment = (from, dest) => {
      let cur = from;
      for (let it = 0; it < 50; it++) {
        if (!s.used && s.cycleDirection * (cur - touchMA) > EPS) s.armed = true;
        let best = NaN, event = 0;
        for (let cand = 1; cand <= 6; cand++) {
          let level = NaN;
          if (s.direction !== 0) {
            if (cand === 1) level = fLimit(cur, dest, s.stop, -s.direction);
            if (cand === 2 && s.opposite) {
              level = fTouch(cur, dest, touchMA);
              if (s.armed && s.cycleDirection === -s.direction && s.cycleDirection * (cur - touchMA) <= 0) level = cur;
            }
            if (cand === 3) level = fLimit(cur, dest, s.target, s.direction);
            if (cand === 4 && s.legs >= 2) level = fLimit(cur, dest, s.entry, s.direction);
            if (cand === 6 && !s.opposite && s.direction === alignment && s.legs < MAX_LEGS && allowed(s.direction))
              level = fLimit(cur, dest, s.entry - s.direction * s.legs * S.gridStep, -s.direction);
          }
          if (cand === 5 && !s.used && s.armed) level = s.cycleDirection * (cur - touchMA) <= 0 ? cur : fTouch(cur, dest, touchMA);
          // 같은 거리면 번호가 작은 사건 우선: 손절, 반대120, 목표, 최초가 회복, 눌림, 추가
          if (finite(level) && (!finite(best) || Math.abs(level - cur) < Math.abs(best - cur) - EPS)) { best = level; event = cand; }
        }
        if (event === 0) {
          if (!s.used && s.cycleDirection * (dest - touchMA) > EPS) s.armed = true;
          return;
        }
        cur = best;
        if (event <= 4) {
          const why = ['', '손절', '반대120 청산', '목표 청산', '최초가 회복'][event];
          const exitPrice = event === 3 ? s.target : event === 4 ? s.entry : cur;
          emit(why, exitPrice, s.direction, 0);
          s.exits++;
          resetPosition();
        } else if (event === 6) {
          s.legs++; s.priceSum += cur;
          emit('추가', cur, s.direction, s.legs);
        } else {
          s.used = true;
          const d = s.cycleDirection, proposed = fTarget(d, cur, d === 1 ? s.impulseHigh : s.impulseLow);
          if (s.direction === 0 && s.exitBar !== i && alignment === d && allowed(d) && finite(proposed)) {
            s.direction = d; s.entry = cur; s.stop = cur - d * S.stopDistance; s.target = proposed;
            s.legs = 1; s.priceSum = cur; s.opposite = false; s.entries++;
            emit('진입', cur, d, 1);
          } else emit('차단', cur, d, 0);
        }
      }
    };
    if (finite(touchMA)) {
      segment(b.open, b.open);
      segment(b.open, b.high);
      segment(b.high, b.low);
      segment(b.low, b.close);
      // 이 봉의 극값은 이 봉의 가상 경로가 끝난 뒤에 쓴다
      if (s.cycleDirection !== 0) { s.impulseHigh = Math.max(s.impulseHigh, b.high); s.impulseLow = Math.min(s.impulseLow, b.low); }
      const crossBuy = p && finite(b.sma20) && finite(b.sma120) && finite(p.sma20) && finite(p.sma120) && b.sma20 > b.sma120 && p.sma20 <= p.sma120;
      const crossSell = p && finite(b.sma20) && finite(b.sma120) && finite(p.sma20) && finite(p.sma120) && b.sma20 < b.sma120 && p.sma20 >= p.sma120;
      if (crossBuy || crossSell) {
        s.cycleDirection = crossBuy ? 1 : -1; s.armed = false; s.used = false;
        s.impulseHigh = b.high; s.impulseLow = b.low;
        if (s.direction !== 0) s.opposite = s.cycleDirection !== s.direction;
      }
    }
    bars.push({
      time: b.time, end: b.end, tint, caption, buyWhy, sellWhy,
      levels: s.direction !== 0 ? {
        entry: s.entry, average: s.legs > 0 ? s.priceSum / s.legs : NaN, stop: s.stop, target: s.target,
        nextAdd: s.legs < MAX_LEGS ? s.entry - s.direction * s.legs * S.gridStep : NaN, direction: s.direction, legs: s.legs,
      } : null,
    });
  }
  return { bars, reasonLabels, blockedLabels, virtualLabels, h1, zones, stats: { entries: s.entries, exits: s.exits } };
}

// 재생 시각(cursor)까지 공개된 것만 — 박스는 그 시점 마지막 확정 H1 상태, 라벨은 원본 보관 수만큼 최근 것
export function jikilAt(result, cursor) {
  if (!result) return null;
  const n = upperBound(result.bars, cursor);
  const k = upperBound(result.h1, cursor) - 1, h = k >= 0 ? result.h1[k] : null, snap = k >= 0 ? result.zones[k] : null;
  const selected = snap && h && snap.end === h.end ? snap.zones : [];
  const pick = (list, keep) => { const m = upperBound(list, cursor); return list.slice(Math.max(0, m - keep), m); };
  return {
    bars: result.bars.slice(0, n),
    last: result.bars[n - 1] || null,
    boxes: h ? displayZones(selected, h.close) : [],
    lastClosedTime: h ? h.end : null,
    reasonLabels: pick(result.reasonLabels, S.reasonKeep),
    blockedLabels: pick(result.blockedLabels, S.reasonKeep),
    virtualLabels: pick(result.virtualLabels, S.virtualKeep),
  };
}

export const formatKSTId = t => {
  const d = new Date((t + 32400) * 1000), p = n => String(n).padStart(2, '0');
  return String(d.getUTCFullYear()).slice(2) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours());
};
