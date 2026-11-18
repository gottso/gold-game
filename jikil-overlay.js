// 지킬 v1.2 차트 그리기 — 11종 연습 '지킬 3분봉' 관찰 차트 위에 4가지를 각각 켜고 끈다.
//  boxes  : H1 지지(청록)·저항(보라) 박스, 낚임형은 점선. 기준봉 ID(yyMMddHH 종류)는 마지막 확정 H1 위치에.
//  ma     : 굵은 SMA20(파랑)·SMA120(주황), 굵기 4
//  avoid  : 금지 구간 배경색(회색=허용시간 밖, 노랑=자료 준비 중, 주황=양방향, 빨강=매수 금지, 청록=매도 금지)
//           + 사유가 바뀐 봉의 사유 라벨 + 첫 눌림 차단 라벨(회색)
//  virtual: 가상 진입·추가·청산 라벨 + 최초가(흰)·평균가(주황)·손절가(빨강)·목표가(연두)·다음 추가 가격(주황 가는 선)
// 계산은 jikil-v12.js. 여기서는 재생 시각까지 공개된 것만 그린다.
import { jikilAt, formatKSTId, JIKIL_COLORS as C } from './jikil-v12.js';

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

  // ---- 좌표 ----
  const firstIndexAtOrAfter = t => { let lo = 0, hi = chartBars.length; while (lo < hi) { const m = (lo + hi) >> 1; if (chartBars[m].time < t) lo = m + 1; else hi = m; } return lo; };
  const xOfTime = t => { const x = chart.timeScale().timeToCoordinate(t); return x != null ? x : chart.timeScale().logicalToCoordinate(firstIndexAtOrAfter(t)); };
  const yOf = p => series.priceToCoordinate(p);

  function label(text, x, y, bg, dir, W, H) {
    // dir 'down' = 점 위에 라벨(꼬리 아래), 'up' = 점 아래에 라벨(꼬리 위), 'left' = 점 오른쪽에 라벨(꼬리 왼쪽)
    const lines = String(text).split('\n');
    ctx.font = '10px system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif';
    const lh = 12, pad = 4, tail = 5;
    const w = Math.ceil(Math.max(...lines.map(s => ctx.measureText(s).width))) + pad * 2, h = lines.length * lh + pad * 2 - 2;
    let bx, by;
    if (dir === 'left') { bx = x + tail; by = y - h / 2; }
    else { bx = x - w / 2; by = dir === 'down' ? y - tail - h : y + tail; }
    if (x < -w || x > W + w || by + h < 0 || by > H) return;
    // 차트 가장자리에서 잘리지 않게 라벨 상자만 안쪽으로 민다 (꼬리는 원래 자리를 가리킨다)
    const shifted = Math.min(Math.max(bx, 2), W - w - 2);
    const moved = shifted !== bx;
    bx = shifted;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, by, w, h, 3) : ctx.rect(bx, by, w, h);
    ctx.fill();
    if (!(dir === 'left' && moved) && x >= 0 && x <= W) {
      ctx.beginPath();
      if (dir === 'left') { ctx.moveTo(x, y); ctx.lineTo(bx, y - 4); ctx.lineTo(bx, y + 4); }
      else if (dir === 'down') { ctx.moveTo(x, y); ctx.lineTo(x - 4, by + h); ctx.lineTo(x + 4, by + h); }
      else { ctx.moveTo(x, y); ctx.lineTo(x - 4, by); ctx.lineTo(x + 4, by); }
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((s, i) => ctx.fillText(s, bx + pad, by + pad + i * lh - 1));
  }

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

    if (parts.boxes && view.boxes.length) {
      const right = view.lastClosedTime != null ? xOfTime(view.lastClosedTime) : W;
      for (const z of view.boxes) {
        const c = z.res ? C.resistance : C.support;
        const x1 = xOfTime(z.bounds), ya = yOf(z.top), yb = yOf(z.bot);
        if (x1 == null || ya == null || yb == null) continue;
        const y = Math.min(ya, yb), hh = Math.max(1, Math.abs(yb - ya)), left = Math.max(-2, x1);
        ctx.globalAlpha = 0.14; ctx.fillStyle = c; ctx.fillRect(left, y, W - left + 2, hh); ctx.globalAlpha = 1;
        ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash(z.family === 1 ? [4, 3] : []);
        ctx.strokeRect(left + 0.5, y + 0.5, W - left + 2, hh - 1); ctx.setLineDash([]);
        if (hh >= 11) {
          ctx.fillStyle = c; ctx.font = '10px system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(z.kind + ' · ' + (z.res ? '저항' : '지지'), Math.max(left, 0) + 4, y + hh / 2);
        }
        if (right != null) label(formatKSTId(z.born) + ' ' + z.kind, right, (ya + yb) / 2, c, 'left', W, H);
      }
    }

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
