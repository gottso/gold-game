// H1 매물대 박스 그리기 — 지킬 3분봉 차트와 '상위 구조' 차트가 같은 모양을 쓴다.
//  지지 청록·저항 보라 반투명 박스, 테두리(낚임형은 원본 지표처럼 점선 테두리),
//  박스 안 '종류 · 지지/저항', 마지막 확정 H1 위치에 기준봉 ID 라벨(yyMMddHH 종류).
//  박스는 구역이 생긴 시각(bounds)에서 시작해 오른쪽 끝까지 이어진다.
import { formatKSTId, JIKIL_COLORS as C } from './jikil-v12.js';

const FONT = '10px system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif';

// 라벨: dir 'down' = 점 위에(꼬리 아래), 'up' = 점 아래에(꼬리 위), 'left' = 점 오른쪽에(꼬리 왼쪽)
export function drawLabel(ctx, text, x, y, bg, dir, W, H) {
  const lines = String(text).split('\n');
  ctx.font = FONT;
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

// 시각 → x 좌표. bars = 지금 차트에 그린 봉(시간 오름차순)
export function timeX(chart, bars, t, { containing = false } = {}) {
  const ts = chart.timeScale(), exact = ts.timeToCoordinate(t);
  if (exact != null) return exact;
  let lo = 0, hi = bars.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].time < t) lo = m + 1; else hi = m; }
  // containing: t 를 품은 봉(예: 4시간봉 안의 30분 시각) / 아니면 t 이후 첫 봉(아직 안 열린 봉이면 마지막 봉 다음 칸)
  return ts.logicalToCoordinate(containing && lo > 0 ? lo - 1 : lo);
}

export function drawZoneBoxes(ctx, { chart, series, bars, boxes, lastClosedTime, W, H }) {
  if (!boxes?.length) return;
  const right = lastClosedTime != null ? timeX(chart, bars, lastClosedTime) : W;
  for (const z of boxes) {
    const c = z.res ? C.resistance : C.support;
    const x1 = timeX(chart, bars, z.bounds, { containing: true }), ya = series.priceToCoordinate(z.top), yb = series.priceToCoordinate(z.bot);
    if (x1 == null || ya == null || yb == null) continue;
    const y = Math.min(ya, yb), hh = Math.max(1, Math.abs(yb - ya)), left = Math.max(-2, x1);
    ctx.globalAlpha = 0.14; ctx.fillStyle = c; ctx.fillRect(left, y, W - left + 2, hh); ctx.globalAlpha = 1;
    ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash(z.family === 1 ? [4, 3] : []);
    ctx.strokeRect(left + 0.5, y + 0.5, W - left + 2, hh - 1); ctx.setLineDash([]);
    if (hh >= 11) {
      ctx.fillStyle = c; ctx.font = FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(z.kind + ' · ' + (z.res ? '저항' : '지지'), Math.max(left, 0) + 4, y + hh / 2);
    }
    if (right != null) drawLabel(ctx, formatKSTId(z.born) + ' ' + z.kind, right, (ya + yb) / 2, c, 'left', W, H);
  }
}

// 박스만 그리는 차트 겹침 캔버스 (상위 구조 차트용)
export function createZoneBoxOverlay({ container, chart, series, zIndex = 2 }) {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const cv = document.createElement('canvas');
  Object.assign(cv.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: String(zIndex) });
  container.appendChild(cv);
  const ctx = cv.getContext('2d');
  let state = { boxes: [], lastClosedTime: null, bars: [] };
  function redraw() {
    const w = container.clientWidth, h = container.clientHeight, d = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) {
      cv.width = Math.round(w * d); cv.height = Math.round(h * d); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!state.boxes.length || !state.bars.length) return;
    let W = 0, H = 0;
    try { const p = chart.paneSize(); W = p.width; H = p.height; } catch { return; }
    if (!W || !H) return;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    drawZoneBoxes(ctx, { chart, series, W, H, ...state });
    ctx.restore();
  }
  new ResizeObserver(() => redraw()).observe(container);
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => redraw());
  return {
    update({ boxes = [], lastClosedTime = null, bars = [] } = {}) { state = { boxes, lastClosedTime, bars }; redraw(); },
    redraw,
  };
}
