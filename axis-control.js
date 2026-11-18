// 차트 축 따로 조절 — 트레이딩뷰처럼 가로(시간)와 세로(가격)를 각각 늘리고 줄인다.
// · 오른쪽 아래 버튼 '자동' ↔ '고정'
//    자동: 보이는 봉에 맞춰 세로가 저절로 맞춰진다 (가로를 바꾸면 세로도 따라 바뀐다)
//    고정: 세로 범위를 붙잡아 둔다 (가로를 바꿔도 세로는 그대로, 차트를 위아래로 끌어 옮길 수 있다)
// · 가격 숫자 칸: 휠·끌기 = 세로만 늘리고 줄인다 → 저절로 '고정'이 된다. 더블클릭·더블탭 = 다시 '자동'
// · 차트 안: 휠·끌기·두 손가락 옆으로 벌리기 = 가로만
// · 폰: 두 손가락을 위아래로 놓고 벌리기·오므리기 = 세로만
// 라이브러리 4.1에는 세로 범위를 직접 정하는 기능이 없다. 그래서 잠깐 autoscaleInfoProvider로 원하는 범위를 맞추고,
// 다음 프레임에 자동 맞춤을 꺼서 '수동 범위'로 굳힌다. 그 뒤로는 라이브러리 자체 수동 모드와 똑같이 동작한다.

const STYLE_ID = 'axis-ctl-style';
const MIN_SPAN = 0.05;          // 세로 범위 최소 폭(가격) — 너무 확대해 한 점으로 뭉개지지 않게
const MAX_SPAN = 1e6;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.axis-ctl{position:absolute;right:0;bottom:0;z-index:6;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
  margin:0;padding:0 2px;min-height:0;border:0;border-left:1px solid;border-top:1px solid;border-radius:0;
  font:600 11px/1 system-ui,-apple-system,'Segoe UI','Malgun Gothic',sans-serif;letter-spacing:.02em;
  cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.axis-ctl:focus-visible{outline:2px solid #e8b84b;outline-offset:-2px}
.axis-ctl.light{background:#ffffff;color:#57606a;border-color:#d0d7de}
.axis-ctl.light:hover{background:#f3f4f6}
.axis-ctl.light.fixed{background:#fff4d6;color:#8a5a00}
.axis-ctl.dark{background:#161b22;color:#a3afbf;border-color:#2a3340}
.axis-ctl.dark:hover{background:#1c232d}
.axis-ctl.dark.fixed{background:#3a2f12;color:#e8b84b}`;
  document.head.appendChild(st);
}

export function attachAxisControl({ chart, container, series, theme = 'light', onChange = () => {} }) {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  injectStyle();
  const ps = chart.priceScale('right');
  const list = (series || []).filter(Boolean);
  const el = chart.chartElement();
  let target = null;            // 다음 프레임에 굳힐 세로 범위 {lo, hi}
  let frame = 0, notify = 0, pinch = null, pressed = false;

  // 같은 가격축의 모든 시리즈가 같은 범위를 내야 서로 넓히지 않는다
  for (const s of list) {
    const prev = s.options().autoscaleInfoProvider;
    s.applyOptions({
      autoscaleInfoProvider: orig =>
        target ? { priceRange: { minValue: target.lo, maxValue: target.hi } } : (prev ? prev(orig) : orig()),
    });
  }

  const btn = document.createElement('div');
  btn.className = 'axis-ctl ' + (theme === 'dark' ? 'dark' : 'light');
  btn.setAttribute('role', 'button');
  btn.tabIndex = 0;
  container.appendChild(btn);

  const pane = () => { try { return chart.paneSize(); } catch { return { width: 0, height: 0 }; } };
  const margins = () => ps.options().scaleMargins || { top: 0.2, bottom: 0.1 };
  const priceAt = y => { for (const s of list) { const v = s.coordinateToPrice(y); if (Number.isFinite(v)) return v; } return null; };

  // 지금 세로 범위(여백 안쪽 기준). 아직 화면에 안 그려진 범위가 있으면 그것을 이어서 쓴다.
  function current() {
    if (target) return target;
    const H = pane().height, m = margins();
    if (!H) return null;
    const hi = priceAt(H * m.top), lo = priceAt(H * (1 - m.bottom));
    return lo != null && hi != null && hi > lo ? { lo, hi } : null;
  }
  // 범위 r 기준으로 화면 y 위치의 가격
  function priceOn(r, y) {
    const H = pane().height, m = margins(), top = H * m.top, span = H * (1 - m.top - m.bottom);
    return span > 0 ? r.hi - (y - top) / span * (r.hi - r.lo) : (r.lo + r.hi) / 2;
  }
  const isFixed = () => ps.options().autoScale === false || !!target;

  function layout() {
    let w = 0, h = 0;
    try { w = ps.width(); h = chart.timeScale().height(); } catch {}
    btn.style.width = (w || 56) + 'px';
    btn.style.height = (h || 24) + 'px';
  }
  function sync() {
    const f = isFixed();
    btn.classList.toggle('fixed', f);
    btn.textContent = f ? '고정' : '자동';
    btn.title = f
      ? '세로 고정 중 — 가로를 바꿔도 세로가 그대로입니다. 누르면 다시 자동 맞춤'
      : '세로 자동 맞춤 — 누르면 지금 세로 범위로 고정합니다. 가격 숫자 칸에서 휠·끌기로 세로만 조절';
    btn.setAttribute('aria-pressed', String(f));
    layout();
  }
  // 화면이 바뀐 다음 프레임에 버튼 상태와 겹쳐 그린 그림(박스·선)을 다시 맞춘다
  function changed() {
    if (notify) return;
    notify = requestAnimationFrame(() => { notify = 0; sync(); onChange(); });
  }
  function setRange(r) {
    if (!r) return;
    let { lo, hi } = r;
    if (!(hi - lo >= MIN_SPAN)) { const c = (lo + hi) / 2; lo = c - MIN_SPAN / 2; hi = c + MIN_SPAN / 2; }
    if (hi - lo > MAX_SPAN) return;
    target = { lo, hi };
    ps.applyOptions({ autoScale: true });            // 이번 프레임: target 범위로 맞춤
    if (!frame) frame = requestAnimationFrame(() => { // 다음 프레임: 그 범위로 굳힘
      frame = 0;
      ps.applyOptions({ autoScale: false });
      target = null;
      sync(); onChange();
    });
  }
  function zoom(k, y) {
    const r = current();
    if (!r) return;
    const P = priceOn(r, y);                          // 커서 자리의 가격은 그대로 두고 위아래로 늘리고 줄인다
    setRange({ lo: P - (P - r.lo) * k, hi: P + (r.hi - P) * k });
  }

  const local = e => { const b = el.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const onPriceAxis = p => { const { width: W, height: H } = pane(); return W > 0 && p.x > W && p.x <= el.clientWidth && p.y >= 0 && p.y <= H; };

  // 가격 숫자 칸 위 휠 = 세로만 (라이브러리는 여기서도 가로를 바꾸므로 먼저 가로챈다)
  container.addEventListener('wheel', e => {
    const p = local(e);
    if (!onPriceAxis(p)) return;
    e.preventDefault(); e.stopPropagation();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (d) zoom(Math.exp(Math.max(-0.4, Math.min(0.4, d * 0.0015))), p.y);
  }, { capture: true, passive: false });

  // 누른 채 움직이는 동안(가격축 끌기·고정 상태에서 위아래 옮기기) 겹쳐 그린 그림을 따라 그린다
  const down = () => { pressed = true; };
  container.addEventListener('mousedown', down, { capture: true, passive: true });
  container.addEventListener('touchstart', down, { capture: true, passive: true });
  const move = () => { if (pressed) changed(); };
  window.addEventListener('mousemove', move, { passive: true });
  window.addEventListener('touchmove', move, { passive: true });
  const up = () => { if (!pressed) return; pressed = false; changed(); };
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
  window.addEventListener('touchcancel', up);
  container.addEventListener('dblclick', () => changed(), { capture: true });

  // 폰: 두 손가락이 위아래로 놓이면 세로만 (옆으로 놓이면 라이브러리가 가로를 처리)
  // 손가락이 닿는 순간(touchstart)·떼는 순간(touchend)은 라이브러리에도 그대로 넘겨 손가락 상태가 어긋나지 않게 하고,
  // 움직임(touchmove)만 가로채서 라이브러리의 가로 확대가 일어나지 않게 한다.
  const two = t => ({
    dx: Math.abs(t[0].clientX - t[1].clientX),
    dy: Math.abs(t[0].clientY - t[1].clientY),
    my: (t[0].clientY + t[1].clientY) / 2,
  });
  container.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) { if (e.touches.length > 2) pinch = null; return; }
    const g = two(e.touches);
    if (!(g.dy > g.dx * 1.2 && g.dy > 24)) { pinch = null; return; }
    const r = current();
    if (!r) return;
    pinch = { d0: g.dy, r, anchor: priceOn(r, g.my - el.getBoundingClientRect().top) };
  }, { capture: true, passive: true });
  container.addEventListener('touchmove', e => {
    if (!pinch) return;
    e.preventDefault(); e.stopPropagation();
    if (e.touches.length < 2) return;
    const g = two(e.touches), k = Math.max(0.05, Math.min(20, pinch.d0 / Math.max(g.dy, 8)));
    const { r, anchor: P } = pinch;
    setRange({ lo: P - (P - r.lo) * k, hi: P + (r.hi - P) * k });
  }, { capture: true, passive: false });
  const endPinch = e => { if (pinch && e.touches.length < 2) { pinch = null; changed(); } };
  container.addEventListener('touchend', endPinch, { capture: true });
  container.addEventListener('touchcancel', endPinch, { capture: true });

  // 버튼: 자동 ↔ 고정
  function toggle() {
    if (isFixed()) { target = null; ps.applyOptions({ autoScale: true }); }
    else ps.applyOptions({ autoScale: false });      // 지금 보이는 세로 범위 그대로 붙잡는다
    changed();
  }
  btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

  new ResizeObserver(() => layout()).observe(container);
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => layout());
  sync();
  requestAnimationFrame(sync);

  return {
    // 봉 간격·데이터를 바꿀 때 다시 자동 맞춤으로
    reset() { target = null; pinch = null; ps.applyOptions({ autoScale: true }); changed(); },
    zoomVertical: (k, y) => zoom(k, y ?? pane().height / 2),
    isFixed,
    sync,
  };
}
