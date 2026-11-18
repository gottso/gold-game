// 개인 백테스트 기록·트레이딩뷰 박스 — 헤더 x-journal-code 가 비밀값 JOURNAL_CODE 와 같을 때만 읽고 쓴다.
// 테이블은 익명 접근이 막혀 있고, 이 함수만 서비스 키로 접근한다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINS = [
  /^https:\/\/gottso\.github\.io$/,
  /^https:\/\/(xaugame|goldgame-nine)\.vercel\.app$/,
  /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/,
];
const allowed = (o: string) => ORIGINS.some((r) => r.test(o));
const cors = (o: string) => ({
  "Access-Control-Allow-Origin": allowed(o) ? o : "https://gottso.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-journal-code",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Vary": "Origin",
});
const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json; charset=utf-8" } });

function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const txt = (v: unknown, n = 200) => (typeof v === "string" && v.length ? v.slice(0, n) : null);
const iso = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? new Date(v * 1000).toISOString() : null);

// 브라우저가 보낸 기록을 허용된 열만 남겨 정리
function cleanTrade(t: Record<string, unknown>) {
  const dir = t.dir === 1 || t.dir === -1 ? t.dir : null;
  const lots = num(t.lots), pnl = num(t.pnl), cid = txt(t.client_id, 160);
  const source = t.source === "free" || t.source === "practice" ? t.source : null;
  const mode = txt(t.mode, 40);
  if (!dir || !lots || lots <= 0 || pnl === null || !cid || !source || !mode) return null;
  const meta = t.meta && typeof t.meta === "object" ? t.meta : {};
  return {
    client_id: cid, source, mode, dir, lots, pnl,
    mode_label: txt(t.mode_label, 80), dataset: txt(t.dataset, 120), run_id: txt(t.run_id, 120),
    entry_time: iso(t.entry_time), entry_price: num(t.entry_price),
    exit_time: iso(t.exit_time), exit_price: num(t.exit_price), exit_reason: txt(t.exit_reason, 120),
    stop: num(t.stop), target: num(t.target), r_multiple: num(t.r_multiple),
    bars_held: Number.isInteger(t.bars_held) ? t.bars_held : null,
    adds: Number.isInteger(t.adds) ? t.adds : 0,
    assumption: txt(t.assumption, 120),
    meta: JSON.stringify(meta).length <= 4000 ? meta : {},
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (!allowed(origin)) return json({ error: "허용되지 않은 출처입니다." }, 403, h);

  const secret = Deno.env.get("JOURNAL_CODE") ?? "";
  if (secret.length < 6) return json({ error: "서버에 기록 코드(JOURNAL_CODE)가 설정되지 않았습니다." }, 500, h);
  if (!sameSecret(req.headers.get("x-journal-code") ?? "", secret)) {
    await new Promise((r) => setTimeout(r, 600)); // 무작위 대입 지연
    return json({ error: "기록 코드가 맞지 않습니다." }, 401, h);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const q = new URL(req.url).searchParams, op = q.get("op") ?? "";

  try {
    if (req.method === "GET" && op === "ping") return json({ ok: true }, 200, h);

    if (req.method === "GET" && op === "trades") {
      let s = db.from("trades").select("*").order("created_at", { ascending: false })
        .limit(Math.min(5000, Math.max(1, parseInt(q.get("limit") ?? "3000", 10) || 3000)));
      const source = q.get("source"), mode = q.get("mode");
      if (source === "free" || source === "practice") s = s.eq("source", source);
      if (mode) s = s.eq("mode", mode.slice(0, 40));
      const { data, error } = await s;
      if (error) throw error;
      return json({ trades: data }, 200, h);
    }

    if (req.method === "POST" && op === "trades") {
      const body = await req.json().catch(() => null);
      const list = Array.isArray(body?.trades) ? body.trades.slice(0, 500) : [];
      const rows = list.map(cleanTrade).filter(Boolean);
      if (!rows.length) return json({ saved: 0, accepted: [] }, 200, h);
      const { error } = await db.from("trades").upsert(rows, { onConflict: "client_id", ignoreDuplicates: true });
      if (error) throw error;
      return json({ saved: rows.length, accepted: rows.map((r) => r!.client_id) }, 200, h);
    }

    if (req.method === "DELETE" && op === "trades") {
      const id = q.get("id") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "잘못된 기록 id" }, 400, h);
      const { error } = await db.from("trades").delete().eq("id", id);
      if (error) throw error;
      return json({ deleted: id }, 200, h);
    }

    if (req.method === "GET" && op === "boxes") {
      const { data, error } = await db.from("tv_boxes").select("id,symbol,top,bottom,t1,t2,extend_right,color,fill,label,synced_at")
        .eq("active", true).eq("symbol", (q.get("symbol") ?? "XAUUSD").slice(0, 30)).order("t1");
      if (error) throw error;
      return json({ boxes: data }, 200, h);
    }

    return json({ error: "지원하지 않는 요청입니다." }, 400, h);
  } catch (e) {
    return json({ error: "서버 오류: " + (e as { message?: string })?.message }, 500, h);
  }
});
