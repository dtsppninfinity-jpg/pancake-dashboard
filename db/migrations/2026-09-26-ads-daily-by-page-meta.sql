-- ============================================================
-- Migration 2026-09-26 — ให้ ads_daily_by_page คืนตัวเลข Meta ด้วย
-- รันไฟล์นี้ใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- (ปลอดภัย: ไม่แตะตาราง ไม่แตะข้อมูล แค่เปลี่ยนฟังก์ชันรวมยอด · รันซ้ำได้)
-- ============================================================
--
-- ทำไม: หน้า Sales เปลี่ยนตัวหาร %ปิด/ค่าทัก ไปใช้ Meta แล้ว (ทีมแอดย้ายไป Meta + Meta สดกว่า)
-- หน้า 🎯 ผลงานราย Unit ต้องใช้ฐานเดียวกัน ไม่งั้นสองหน้าโชว์ %ปิด ไม่ตรงกัน
-- แต่ ad_daily ทั้งเดือน ~110,000 แถว ห้ามลากดิบมารวมในเว็บ (กิน egress) จึงต้องรวมในฐานข้อมูล
--
-- ⚠️ ต้อง drop ก่อน create — Postgres เปลี่ยน return type ของฟังก์ชันเดิมไม่ได้
--    ("cannot change return type of existing function") ทั้งสองคำสั่งอยู่ใน transaction เดียว
--    ถ้าพลาดจะ rollback ทั้งก้อน ฟังก์ชันเดิมไม่หาย
--
-- ⚠️ ก่อนรัน migration นี้ หน้าผลงานราย Unit จะอ่าน meta_* ไม่เจอ (undefined = 0)
--    แล้วถอยไปใช้ฐาน Pancake เอง — ไม่พัง แค่ยังไม่สลับ

begin;

drop function if exists ads_daily_by_page(date, date);

create function ads_daily_by_page(
  p_from date,
  p_to   date
) returns table (
  d date,
  page_id text,
  spend numeric,
  msgs numeric,
  first_replies numeric,
  meta_first_replies numeric,
  meta_comments numeric
)
language sql stable as $$
  select
    a.date                                   as d,
    coalesce(a.page_id, '')                  as page_id,
    sum(coalesce(a.spend, 0))                as spend,
    sum(coalesce(a.msgs_started, 0))         as msgs,
    sum(coalesce(a.first_replies, 0))        as first_replies,
    sum(coalesce(a.meta_first_replies, 0))   as meta_first_replies,
    sum(coalesce(a.meta_comments, 0))        as meta_comments
  from ad_daily a
  where a.date >= p_from and a.date <= p_to
  group by 1, 2
$$;

commit;

-- เช็คว่าผ่านแล้ว (ควรได้ 7 คอลัมน์ และ meta_* ไม่เป็น 0 ทั้งหมดสำหรับวันหลัง 17 ก.ย. 69):
-- select * from ads_daily_by_page('2026-09-25', '2026-09-25') order by spend desc limit 5;
