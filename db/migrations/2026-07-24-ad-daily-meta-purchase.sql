-- ============================================================
-- Migration 2026-07-24 — เพิ่ม field ที่ Meta Ads dashboard ใช้ ลง ad_daily
-- รันใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run  (ปลอดภัย รันซ้ำได้)
--
-- ทำไม: บอสต้องการให้ตัวเลขฝั่งแอด (ROAS / %ปิด / ยอดขายจากแอด) "เหมือนหน้า Meta Ads
-- dashboard เป๊ะ" — ซึ่ง Meta รายงานค่าพวกนี้จาก pixel ของตัวเอง ไม่ใช่ยอด POS ของเรา
--   meta_purchases       = จำนวน "ซื้อ" ที่ Meta ตี (ตัวตั้งของ %ปิดแบบ Meta)
--   meta_purchase_value  = "ยอดขาย" ที่ Meta ตี (บาทจริง — ตัวตั้งของ ROAS แบบ Meta)
--   meta_roas            = purchase_roas ที่ Meta ส่งมาต่อแอด (เก็บไว้ตรวจ ไม่ใช่ตัวหลัก —
--                          ระดับรวมต้องคิดใหม่ sum(value)/sum(spend) ห้ามเฉลี่ย roas รายแอด)
--
-- พิสูจน์แล้ว 2026-07-23: sum(meta_purchase_value)/sum(spend) = 2.32x ตรงกับ Meta 2.21x,
-- sum(meta_purchases)/sum(msgs_started) = 32.0% ตรงกับ Meta 32.9% (ต่างเพราะ Meta ตัดซ้ำ
-- ข้ามบัญชี + snapshot คนละเวลา แต่ "อัตรา" ตรงเพราะซ้ำทั้งเศษทั้งส่วน)
-- ============================================================

alter table ad_daily add column if not exists meta_purchases      numeric default 0;
alter table ad_daily add column if not exists meta_purchase_value numeric default 0;
alter table ad_daily add column if not exists meta_roas           numeric default 0;
