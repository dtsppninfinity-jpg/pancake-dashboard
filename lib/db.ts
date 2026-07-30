// lib/db.ts — Supabase read client สำหรับฝั่ง Next.js (server-side เท่านั้น)
// ใช้ service key อ่าน DB จาก server components / route handlers — ไม่ถูกส่งไป browser
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const db = createClient(url, key, { auth: { persistSession: false } });

/**
 * ดึงทุกแถวของ query โดยวนทีละ 1000 แถวจนครบ
 * (PostgREST คืนสูงสุด 1000 แถว/ครั้ง — ถ้า select ตรงๆ แล้วเอาไปรวมยอดจะผิดเมื่อข้อมูลเกิน 1000)
 * ใช้: const rows = await fetchAll(() => db.from('orders').select('total_price,status').gte('inserted_at', iso));
 */
export async function fetchAll<T = any>(build: () => any, orderColumn = 'id', ascending = true): Promise<T[]> {
  const PAGE = 1000;
  const CONC = 6; // จำนวนหน้าที่ยิงพร้อมกันหลังหน้าแรกเต็ม
  // รับหลายคอลัมน์คั่นด้วยคอมมาได้ (เช่น 'date,ad_id') — ตารางที่ primary key เป็นคู่คอลัมน์
  // ต้องเรียงครบทุกคอลัมน์ ไม่งั้นลำดับยังไม่ unique และ pagination ก็ยังข้ามแถวได้อยู่ดี
  const cols = orderColumn.split(',').map((s) => s.trim()).filter(Boolean);
  const getPage = async (from: number): Promise<T[]> => {
    // ต้อง .order() บนคอลัมน์ที่ unique (มัก = primary key) — ไม่งั้น PostgREST อาจคืนลำดับไม่คงที่
    // ข้าม page เมื่อข้อมูลเกิน 1000 แถว → ข้าม/นับซ้ำ → ยอดผิดเงียบๆ
    let q = build();
    for (const c of cols) q = q.order(c, { ascending });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAll: ${error.message}`);
    return data || [];
  };
  // หน้าแรกยิงเดี่ยวก่อน — query ส่วนใหญ่ไม่ถึง 1000 แถว จบใน 1 คำขอเท่าเดิม
  const out: T[] = await getPage(0);
  if (out.length < PAGE) return out;
  // ข้อมูลใหญ่ → ยิงทีละชุด CONC หน้าพร้อมกัน (เดิมวนทีละหน้า — orders เดือนเดียว 60+ หน้า
  // กิน 60 round-trip ต่อคิว จนหน้า Admin Performance ชน FUNCTION_INVOCATION_TIMEOUT 60s)
  // หน้าท้ายชุดที่เกินตัวจบจะคืนว่าง — เสียคำขอเปล่าไม่เกิน CONC-1 ครั้ง แลกกับเวลารวมที่หารด้วย CONC
  for (let base = PAGE; ; base += CONC * PAGE) {
    const pages = await Promise.all(
      Array.from({ length: CONC }, (_, i) => getPage(base + i * PAGE)),
    );
    let done = false;
    for (const p of pages) {
      out.push(...p);
      if (p.length < PAGE) { done = true; break; }
    }
    if (done) break;
  }
  return out;
}

/**
 * ดึงตารางใหญ่ที่กรองด้วยช่วงเวลา โดย "หั่นช่วงเป็นก้อนละไม่กี่วัน" แล้วดึงขนาน
 *
 * ทำไมไม่ใช้ fetchAll เฉยๆ: PostgREST แบ่งหน้าโดย OFFSET — ที่แถวลึกๆ (หน้า 50+)
 * Postgres ต้องไล่สแกนแถวก่อนหน้าทั้งหมดทุกคำขอ ช้าลงเรื่อยๆ และชน statement timeout จริง
 * (เจอ "canceling statement due to statement timeout" ตอนดึง orders 35 วัน ~90k แถว)
 * หั่นเป็นก้อน 4 วัน offset ต่อก้อนไม่เกิน ~10 หน้า → เร็วและไม่มีทาง timeout
 *
 * build(fromIso, toIso) ต้องคืน query ที่กรองคอลัมน์เวลาด้วย gte(from) + lt(to) เอง
 * ช่วงก้อนต่อกันแบบ [from, to) — แถวบนรอยต่อไม่ซ้ำไม่หาย
 */
export async function fetchAllSliced<T = any>(
  build: (fromIso: string, toIso: string) => any,
  start: Date,
  end: Date,
  opts: { sliceDays?: number; pool?: number; orderColumn?: string } = {},
): Promise<T[]> {
  const sliceMs = (opts.sliceDays || 4) * 86400000;
  // pool 2 ก็พอ — ยิงเยอะกว่านี้คิวรีแย่ง CPU กันเองบนฐาน แล้วแต่ละตัวช้าจนชน statement timeout (~8s)
  // (ทดลองจริง: pool 3 × 7 คำขอย่อย = ล้ม, pool 2 = ผ่าน)
  const pool = opts.pool || 2;
  // เรียงตามคอลัมน์เวลาที่กรอง (ตาม index → ไม่ต้อง sort ทั้งก้อนทุกหน้า) + ตาม id กันลำดับไม่ unique
  const orderCols = opts.orderColumn || 'inserted_at,id';
  const endMs = end.getTime() + 1; // ให้ lt(to) ครอบแถว ณ เวลา end พอดี
  const slices: Array<{ f: string; t: string }> = [];
  for (let t0 = start.getTime(); t0 < endMs; t0 += sliceMs) {
    slices.push({ f: new Date(t0).toISOString(), t: new Date(Math.min(t0 + sliceMs, endMs)).toISOString() });
  }
  const out: T[] = [];
  for (let i = 0; i < slices.length; i += pool) {
    const parts = await Promise.all(
      slices.slice(i, i + pool).map((s) => fetchAll<T>(() => build(s.f, s.t), orderCols, true)),
    );
    for (const p of parts) out.push(...p);
  }
  return out;
}
