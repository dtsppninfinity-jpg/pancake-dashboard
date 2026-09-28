// lib/api/chatagg.ts — ยอดแชทรายวันที่ฐานรวมมาให้ (ฟังก์ชัน dash_chat_daily ใน db/migrations/2026-09-28-dashboard-aggregates.sql)
// ใช้ร่วมหน้าภาพรวมแชท + ยอดขาย: แทนการลากแถว chat_hourly รายชั่วโมงทั้งช่วง (~1,200 แถว/วัน) มาบวกในเว็บ
import { db } from '@/lib/db';

/**
 * แชทรายวันต่อ platform [fromStr..toStr] (YYYY-MM-DD รวมปลายทั้งคู่) — คืนแถวที่ชื่อคอลัมน์เหมือน chat_hourly
 * (date, platform, ยอดรวมของทุกคอลัมน์ตัวเลข) ลูปเดิมที่บวกทีละแถวใช้ได้ทันที · ผลรวมเป็นจำนวนเต็มล้วน ลำดับแถวไม่มีผล
 * null = ยังไม่ได้รัน migration / ฐานตอบพลาด / ผลผิดรูป → ผู้เรียกถอยไปอ่านแถวดิบแบบเดิม (ตัวเลขเท่ากันทั้งสองทาง)
 */
export async function chatDailyRpc(fromStr: string, toStr: string): Promise<any[] | null> {
  try {
    const { data, error } = await db.rpc('dash_chat_daily', { p_from: fromStr, p_to: toStr }).abortSignal(AbortSignal.timeout(20_000));
    if (error || !Array.isArray(data)) return null;
    // วัน × platform ไม่กี่ร้อยแถว — ถึง 1,000 (เพดาน PostgREST) แปลว่าอาจได้ไม่ครบ ถอยไปทางเดิมดีกว่าได้ครึ่งเดียว
    if (data.length >= 1000) return null;
    return (data as any[]).map((r) => ({
      date: r.d, platform: r.platform,
      customer_inbox_count: r.customer_inbox_count, customer_comment_count: r.customer_comment_count,
      page_inbox_count: r.page_inbox_count, page_comment_count: r.page_comment_count,
      new_inbox_count: r.new_inbox_count, new_customer_count: r.new_customer_count,
      uniq_phone_number_count: r.uniq_phone_number_count,
    }));
  } catch { return null; }
}
