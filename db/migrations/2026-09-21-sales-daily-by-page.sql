-- ============================================================
-- Migration 2026-09-21 — ยอดขายรายวันแยกตามเพจ (ตาราง "📅 ยอดขายรายวัน" หน้า Sales)
-- รันไฟล์นี้ใน Supabase: Dashboard → SQL Editor → วาง → Run
-- (ปลอดภัย: or replace — รันซ้ำได้ ไม่สร้าง/ลบตาราง ไม่แตะข้อมูลเดิม)
-- ============================================================
--
-- ทำไมต้องรวมยอดฝั่ง Postgres: ตารางรายวัน 7-30 วัน = ออเดอร์ 12,000-60,000 แถว
-- และหน้า Sales รีเฟรชเองทุก 75 วินาที ถ้าลากแถวดิบมารวมใน API จะกิน egress หลาย GB/วัน
-- ฟังก์ชันนี้รวมให้เสร็จในฐานข้อมูล แล้วคืนแค่ "วัน × เพจ × ช่องทาง" (หลักร้อยแถว)
--
-- กติกาต้องตรงกับฝั่งเว็บ (lib/config.ts + lib/api/sales.ts):
--   • สถานะที่ตัดทิ้งส่งมาจาก API เสมอ — p_excluded = EXCLUDED_STATUSES (ยกเลิก/ตีกลับ),
--     p_needcheck = NEED_CHECK_STATUSES (ยังไม่นับเป็นยอด เช่น รอสินค้า)
--     ค่า default ไว้กันคนเรียกมือเปล่าเท่านั้น — ความจริงอยู่ที่ lib/config.ts ที่เดียว
--   • ออเดอร์เปล่า (isPlaceholderOrder) = ไม่มีสินค้า และราคา 0 → ตัดทิ้ง
--   • revenue คืนเป็น "สตางค์" ตามที่ Pancake เก็บ — ฝั่งเว็บหาร MONEY_SCALE เอง
--   • channel ตรงกับ platformChannel_ (ว่าง/instagram/messenger นับเป็น facebook)
--   • วันคิดตามเวลาไทย (Asia/Bangkok) เหมือนทุกจอ
create or replace function sales_daily_by_page(
  p_from      timestamptz,
  p_to        timestamptz,
  p_excluded  int[] default array[4, 5, 6, 7, 15],
  p_needcheck int[] default array[0, 17, 11]
) returns table (d date, page_id text, channel text, revenue numeric, orders bigint)
language sql stable as $$
  select
    ((o.inserted_at at time zone 'Asia/Bangkok')::date)   as d,
    coalesce(o.page_id, '')                               as page_id,
    case when lower(coalesce(o.platform, '')) = 'line' then 'line'
         when lower(coalesce(o.platform, '')) in ('facebook', 'instagram', 'messenger', '') then 'facebook'
         else 'other' end                                 as channel,
    sum(coalesce(o.total_price, 0))                       as revenue,
    count(*)                                              as orders
  from orders o
  where o.inserted_at >= p_from
    and o.inserted_at <  p_to
    and not (coalesce(o.status, 0) = any (p_excluded))
    and not (coalesce(o.status, 0) = any (p_needcheck))
    and not (coalesce(o.items_count, 0) = 0 and coalesce(o.total_price, 0) = 0)
  group by 1, 2, 3
$$;
