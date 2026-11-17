// 트레이딩뷰에서 읽어온 박스를 차트 위 투명 캔버스에 그린다 (구분 없이 하나의 토글).
// 박스 좌표는 시간·가격이라 어떤 봉 간격에서도 같은 자리에 그려지고, 재생 시각 이후 부분은 그리지 않는다.
const toSec=v=>v==null?null:typeof v==='number'?v:Math.floor(Date.parse(v)/1000);

export function normalizeBoxes(rows){
 return (rows||[]).map(b=>({id:b.id,top:+b.top,bottom:+b.bottom,t1:toSec(b.t1),t2:toSec(b.t2),extendRight:!!(b.extend_right??b.extendRight),
  color:b.color||null,fill:b.fill||null,label:b.label||null})).filter(b=>Number.isFinite(b.top)&&Number.isFinite(b.bottom)&&Number.isFinite(b.t1));
}
// 재생 시각(now)까지 공개된 구간만: 시작 전 박스는 숨기고, 오른쪽 끝은 now에서 자른다
export function visibleSpan(box,now){
 if(!(box.t1<now))return null;
 const right=box.extendRight||box.t2==null?now:Math.min(box.t2,now);
 return right>=box.t1?{left:box.t1,right}:null;
}
function lastIndexAtOrBefore(bars,t){let lo=0,hi=bars.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(bars[m].time<=t){r=m;lo=m+1;}else hi=m-1;}return r;}

export function createBoxOverlay({container,chart,series,getBars,getNow,zIndex=3}){
 if(getComputedStyle(container).position==='static')container.style.position='relative';
 const cv=document.createElement('canvas');
 Object.assign(cv.style,{position:'absolute',left:'0',top:'0',pointerEvents:'none',zIndex:String(zIndex)});
 container.appendChild(cv);
 const ctx=cv.getContext('2d');let boxes=[],visible=false;
 function size(){const w=container.clientWidth,h=container.clientHeight,d=window.devicePixelRatio||1;cv.width=w*d;cv.height=h*d;cv.style.width=w+'px';cv.style.height=h+'px';ctx.setTransform(d,0,0,d,0,0);}
 function redraw(){
  ctx.clearRect(0,0,cv.width,cv.height);
  if(!visible||!boxes.length)return;
  const bars=getBars(),now=getNow();if(!bars?.length||!Number.isFinite(now))return;
  const ts=chart.timeScale(),half=(ts.options().barSpacing||6)/2;let axis=0;try{axis=chart.priceScale('right').width();}catch{}
  const W=cv.clientWidth-axis,H=cv.clientHeight;
  ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();
  for(const b of boxes){
   const span=visibleSpan(b,now);if(!span||span.right<bars[0].time)continue;
   const i1=Math.max(0,lastIndexAtOrBefore(bars,span.left)),i2=lastIndexAtOrBefore(bars,span.right);if(i2<0)continue;
   const xa=ts.timeToCoordinate(bars[i1].time),xb=ts.timeToCoordinate(bars[i2].time),ya=series.priceToCoordinate(b.top),yb=series.priceToCoordinate(b.bottom);
   if([xa,xb,ya,yb].some(v=>v==null))continue;
   const x=xa-half,w=Math.max(2,xb-xa+2*half),y=Math.min(ya,yb),h=Math.max(1,Math.abs(yb-ya));
   ctx.fillStyle=b.fill||'rgba(255,152,0,0.14)';ctx.fillRect(x,y,w,h);
   ctx.strokeStyle=b.color||'rgba(255,152,0,0.85)';ctx.lineWidth=1;ctx.setLineDash([]);ctx.strokeRect(x+.5,y+.5,w-1,h-1);
   if(w>24){ctx.fillStyle=b.color||'rgba(255,152,0,1)';ctx.font='10px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(b.label||'TV',x+3,y+2);}
  }
  ctx.restore();
 }
 size();
 new ResizeObserver(()=>{size();redraw();}).observe(container);
 chart.timeScale().subscribeVisibleLogicalRangeChange(()=>redraw());
 return {
  setBoxes(rows){boxes=normalizeBoxes(rows);redraw();},
  setVisible(v){visible=!!v;redraw();},
  get visible(){return visible;},get count(){return boxes.length;},
  redraw
 };
}
