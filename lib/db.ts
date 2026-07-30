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
