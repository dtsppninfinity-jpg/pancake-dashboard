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
  let from = 0;
  const out: T[] = [];
  for (;;) {
    // ต้อง .order() บนคอลัมน์ที่ unique (มัก = primary key) — ไม่งั้น PostgREST อาจคืนลำดับไม่คงที่
    // ข้าม page เมื่อข้อมูลเกิน 1000 แถว → ข้าม/นับซ้ำ → ยอดผิดเงียบๆ
    const { data, error } = await build().order(orderColumn, { ascending }).range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAll: ${error.message}`);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
