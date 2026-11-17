// Twelve Data 시세 프록시 — API 키는 Supabase 비밀값(TWELVE_DATA_KEY)에만 있고 브라우저로 나가지 않는다.
// 허용: XAU/USD time_series, 정해진 봉 간격, gottso.github.io·로컬 개발 출처만.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const INTERVALS = new Set(["1min", "5min", "15min", "30min", "1h"]);
const ORIGINS = [/^https:\/\/gottso\.github\.io$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
const DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;
const TTL_MS = 60_000; // 같은 요청은 1분간 재사용 → 무료 한도(분당 8회) 절약
const cache = new Map<string, { t: number; body: string }>();

const allowed = (o: string) => ORIGINS.some((r) => r.test(o));
function cors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowed(origin) ? origin : "https://gottso.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}
const reply = (body: unknown, status: number, h: Record<string, string>, extra: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { ...h, ...extra, "Content-Type": "application/json; charset=utf-8" },
  });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "GET") return reply({ status: "error", message: "GET만 지원합니다." }, 405, h);
  if (!allowed(origin)) return reply({ status: "error", message: "허용되지 않은 출처입니다." }, 403, h);

  const key = Deno.env.get("TWELVE_DATA_KEY");
  if (!key) return reply({ status: "error", message: "서버에 Twelve Data 키가 설정되지 않았습니다." }, 500, h);

  const q = new URL(req.url).searchParams;
  const interval = q.get("interval") ?? "";
  if (!INTERVALS.has(interval)) return reply({ status: "error", message: "지원하지 않는 봉 간격입니다." }, 400, h);
  const size = Math.min(5000, Math.max(1, parseInt(q.get("outputsize") ?? "100", 10) || 100));
  const p = new URLSearchParams({
    symbol: "XAU/USD", interval, outputsize: String(size), timezone: "UTC", order: "ASC", format: "JSON",
  });
  for (const k of ["start_date", "end_date"]) {
    const v = q.get(k);
    if (!v) continue;
    if (!DATE_RE.test(v)) return reply({ status: "error", message: `${k} 형식이 올바르지 않습니다.` }, 400, h);
    p.set(k, v);
  }

  const ck = p.toString();
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < TTL_MS) return reply(hit.body, 200, h, { "X-Cache": "HIT" });

  p.set("apikey", key);
  let r: Response;
  try {
    r = await fetch("https://api.twelvedata.com/time_series?" + p);
  } catch {
    return reply({ status: "error", message: "시세 제공처에 연결하지 못했습니다." }, 502, h);
  }
  const body = (await r.text()).split(key).join("[숨김]");
  let ok = r.ok;
  try { ok = ok && JSON.parse(body)?.status !== "error"; } catch { ok = false; }
  if (ok) {
    cache.set(ck, { t: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return reply(body, r.status, h, { "X-Cache": "MISS" });
});
