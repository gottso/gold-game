// 지킬 v1.2 차트 그리기 — 11종 연습 '지킬 3분봉' 관찰 차트 위에 4가지를 각각 켜고 끈다.
//  boxes  : H1 지지(청록)·저항(보라) 박스, 낚임형은 점선. 기준봉 ID(yyMMddHH 종류)는 마지막 확정 H1 위치에.
//  ma     : 굵은 SMA20(파랑)·SMA120(주황), 굵기 4
//  avoid  : 금지 구간 배경색(회색=허용시간 밖, 노랑=자료 준비 중, 주황=양방향, 빨강=매수 금지, 청록=매도 금지)
//           + 사유가 바뀐 봉의 사유 라벨 + 첫 눌림 차단 라벨(회색)
//  virtual: 가상 진입·추가·청산 라벨 + 최초가(흰)·평균가(주황)·손절가(빨강)·목표가(연두)·다음 추가 가격(주황 가는 선)
// 계산은 jikil-v12.js. 여기서는 재생 시각까지 공개된 것만 그린다.
import { jikilAt, JIKIL_COLORS as C } from './jikil-v12.js';
import { drawLabel, drawZoneBoxes } from './zone-boxes.js';

const finite = Number.isFinite;
const VIRTUAL_COLOR = (kind, d) => kind === '손절' ? '#f23645' : kind === '진입' ? (d === 1 ? '#089981' : '#e040fb') : kind === '추가' ? '#ff9800' : '#2962ff';

export function createJikilOverlay({ container, chart, series, zIndex = 2 }) {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const cv = document.createElement('canvas');
  Object.assign(cv.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: String(zIndex) });
  container.appendChild(cv);
  const ctx = cv.getContext('2d');

  // 지표 선은 세로 자동 맞춤에 끼지 않게 한다 (굵은 이평은 이미 그려진 얇은 이평과 같은 값)
  const quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null };
  const ma20 = chart.addLineSeries({ color: C.ma20, lineWidth: 4, ...quiet });
  const ma120 = chart.addLineSeries({ color: C.ma120, lineWidth: 4, ...quiet });
  // 가상 가격선은 원본 plot.style_linebr 처럼 포지션이 없으면 끊겨야 한다.
  // 라이브러리 선은 빈 값을 건너뛰어 이어 버리므로 캔버스에 직접 그린다.
  const LEVEL_STYLE = [
    ['entry', '#ffffff', 2], ['average', 'rgba(255,152,0,0.8)', 1], ['stop', '#f23645', 2],
    ['target', '#00e676', 2], ['nextAdd', '#ff9800', 1],
  ];

  let view = null, chartBars = [], active = false;
  let parts = { boxes: true, ma: true, avoid: true, virtual: false };

  function size() {
    const w = container.clientWidth, h = container.clientHeight, d = window.devicePixelRatio || 1;
    cv.width = Math.round(w * d); cv.height = Math.round(h * d);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  function setLines() {
    const showMa = active && parts.ma;
    ma20.setData(showMa ? chartBars.filter(b => finite(b.sma20)).map(b => ({ time: b.time, value: b.sma20 })) : []);
    ma120.setData(showMa ? chartBars.filter(b => finite(b.sma120)).map(b => ({ time: b.time, value: b.sma120 })) : []);
  }

  function drawLevels(ts) {
    const byTime = new Map(view.bars.map(b => [b.time, b.levels]));
    for (const [key, color, width] of LEVEL_STYLE) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash([]);
      let open = false;
      ctx.beginPath();
      for (const b of chartBars) {
        const lv = byTime.get(b.time), v = lv ? lv[key] : NaN, x = ts.timeToCoordinate(b.time), y = finite(v) ? yOf(v) : null;
        if (x == null || y == null) { open = false; continue; }
        if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y); open = true; }
      }
      ctx.stroke();
    }
  }

  const yOf = p => series.priceToCoordinate(p);
  const label = (text, x, y, bg, dir, W, H) => drawLabel(ctx, text, x, y, bg, dir, W, H);

  function redraw() {
    const w = container.clientWidth, h = container.clientHeight, d = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) size();
    ctx.clearRect(0, 0, w, h);
    if (!active || !view || !chartBars.length) return;
    let W = 0, H = 0;
    try { const p = chart.paneSize(); W = p.width; H = p.height; } catch { return; }
    if (!W || !H) return;
    const ts = chart.timeScale(), spacing = ts.options().barSpacing || 6;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    if (parts.avoid) {
      // 같은 색이 이어지는 봉은 한 번에 칠한다 (봉마다 칠하면 이음새에 줄무늬가 생긴다)
      const byTime = new Map(view.bars.map(b => [b.time, b.tint]));
      let run = null;
      const flush = () => { if (run) { ctx.fillStyle = `rgba(${run.tint},0.12)`; ctx.fillRect(run.x1, 0, run.x2 - run.x1, H); run = null; } };
      for (const b of chartBars) {
        const tint = byTime.get(b.time), x = ts.timeToCoordinate(b.time);
        if (!tint || x == null) { flush(); continue; }
        const x1 = Math.round(x - spacing / 2), x2 = Math.round(x + spacing / 2);
        if (run && run.tint === tint && x1 <= run.x2 + 1) run.x2 = x2;
        else { flush(); run = { tint, x1, x2 }; }
      }
      flush();
    }

    if (parts.boxes) drawZoneBoxes(ctx, { chart, series, bars: chartBars, boxes: view.boxes, lastClosedTime: view.lastClosedTime, W, H });

    if (parts.avoid) {
      for (const l of view.reasonLabels) {
        const x = ts.timeToCoordinate(l.time), y = yOf(l.price);
        if (x != null && y != null) label(l.text, x, y - 6, l.color, 'down', W, H);
      }
      for (const l of view.blockedLabels) {
        const x = ts.timeToCoordinate(l.time), y = yOf(l.price);
        if (x != null && y != null) label(l.text, x, y, '#787b86', l.d === 1 ? 'up' : 'down', W, H);
      }
    }

    if (parts.virtual) {
      drawLevels(ts);
      for (const l of view.virtualLabels) {
        const x = ts.timeToCoordinate(l.time), y = yOf(l.price);
        if (x != null && y != null) label(l.text, x, y, VIRTUAL_COLOR(l.kind, l.d), l.d === 1 ? 'up' : 'down', W, H);
      }
    }
    ctx.restore();
  }

  size();
  new ResizeObserver(() => { size(); redraw(); }).observe(container);
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => redraw());

  return {
    // result: computeJikil() 결과, bars: 지금 차트에 그린 봉, cursor: 재생 시각, active: 지킬 3분봉일 때만 true
    update({ result, bars, cursor, active: on, parts: p }) {
      active = !!on && !!result;
      chartBars = bars || [];
      if (p) parts = { ...parts, ...p };
      view = active ? jikilAt(result, cursor) : null;
      setLines();
      redraw();
      return view;
    },
    redraw,
    get view() { return view; },
  };
}
