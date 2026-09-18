-- ============================================================
-- Migration 2026-09-18 — เก็บ "คนทัก/คอมเมนต์" จาก Meta ลง ad_daily
-- รันใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run  (ปลอดภัย รันซ้ำได้)
--
-- ทำไม: ทีมแอด (เว็บ ADS SUMMARY) คิด %ปิด จากฐาน "รวมคนทัก = ทัก + คอมเมนต์" ของ Meta
--   ทัก      = action_type `onsite_conversion.messaging_first_reply`
--   คอมเมนต์ = action_type `comment`
-- ของเดิมในตารางนี้:
--   msgs_started  = messaging_conversation_started_7d  ← คนละตัว ใช้แทนกันไม่ได้
--                   (วัดวันเดียวกัน 17 ก.ย. 2569: first_reply 1,351 vs started 1,431)
--   first_replies = messaging_first_reply แต่มาจาก Pancake statistics/ads (ช้ากว่า Meta
--                   และไม่ครบทุกบัญชี — 18 ก.ย. 09:26 Pancake 1,332 vs Meta 1,351)
-- คอลัมน์ใหม่จึงแยกแหล่งให้ชัด ไม่ทับของ Pancake:
--   meta_first_replies = ทัก (จาก Meta ตรงๆ)
--   meta_comments      = คอมเมนต์ (จาก Meta ตรงๆ) ← ไม่เคยเก็บมาก่อนเลย
--
-- ⚠️ ข้อมูลย้อนหลังจะเป็น 0 จนกว่างาน meta-ads จะวิ่งทับ (ปกติวิ่งทุก 15 นาที ครอบคลุม
--    เมื่อวาน+วันนี้) วันเก่ากว่านั้นถ้าต้องการต้อง backfill แยก — หน้าเว็บจึงถอยไปใช้
--    first_replies ของ Pancake เมื่อไม่มีค่าของ Meta และบอกไว้ใน tooltip ว่าฐานไม่รวมคอมเมนต์
-- ============================================================

alter table ad_daily add column if not exists meta_first_replies numeric default 0;
alter table ad_daily add column if not exists meta_comments      numeric default 0;
