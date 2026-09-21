-- ============================================================
-- Migration 2026-09-21 (ที่ 2) — ค่าแอดรายวันต่อเพจ (หน้า 🎯 ผลงานราย Unit)
-- รันไฟล์นี้ใน Supabase: Dashboard → SQL Editor → วาง → Run
-- (ปลอดภัย: or replace — รันซ้ำได้ ไม่สร้าง/ลบตาราง ไม่แตะข้อมูลเดิม)
-- ============================================================
--
-- ad_daily เก็บ "รายแอด × วัน" — ทั้งเดือนคือ ~110,000 แถว ถ้าลากมารวมใน API จะกิน egress หนักมาก
-- ฟังก์ชันนี้รวมให้เสร็จในฐานข้อมูล คืนแค่ "วัน × เพจ" (~5,000 แถว/เดือน)
--   • spend เป็นบาทจริง (ad_daily.spend ไม่ใช่สตางค์ ห้ามหาร 100)
--   • เพจที่ยังผูก page_id ไม่ได้จะรวมกันอยู่ที่ page_id = '' (ฝั่งเว็บโยนเข้ากลุ่ม "ยังไม่จัดกลุ่ม")
--   • ผู้เรียกต้องแบ่งหน้า .range() ทีละ 1,000 เสมอ — PostgREST ตัดผลลัพธ์ที่ 1,000 แถวรวม RPC ด้วย
create or replace function ads_daily_by_page(
  p_from date,
  p_to   date
) returns table (d date, page_id text, spend numeric, msgs numeric, first_replies numeric)
language sql stable as $$
  select
    a.date                                   as d,
    coalesce(a.page_id, '')                  as page_id,
    sum(coalesce(a.spend, 0))                as spend,
    sum(coalesce(a.msgs_started, 0))         as msgs,
    sum(coalesce(a.first_replies, 0))        as first_replies
  from ad_daily a
  where a.date >= p_from and a.date <= p_to
  group by 1, 2
$$;
