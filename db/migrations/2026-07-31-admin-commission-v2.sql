-- ============================================================
-- Migration 2026-07-31 — admin_commission v2: อ่านจาก "ตารางประเมินรายเดือน" ในแท็บ Com:Admin
-- รันใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run  (ปลอดภัย รันซ้ำได้)
--
-- บอสสั่ง (2026-07-30): เอาคอลัมน์ "คงเหลือ" (= ยอดจริงหลังหักตีกลับ/ยกเลิก) กับ
-- "Commission (Admin)" จากตารางประเมินรายเดือนตรงๆ — ไม่รวมเองจากรายวัน
-- เพราะคอมจริงมีเงื่อนไขถึงเป้า/ไม่ถึงเป้าที่ชีทคิดไว้แล้ว (ยอดสูงแต่คอม 0 มีจริง)
-- แถมได้ ชื่อจริง / ตีกลับ / ยกเลิก / %ปิดลูกค้าใหม่ ต่อคนต่อเดือนมาด้วย
-- ============================================================

alter table admin_commission add column if not exists real_name  text    default '';
alter table admin_commission add column if not exists returns    numeric default 0;
alter table admin_commission add column if not exists cancel     numeric default 0;
alter table admin_commission add column if not exists remaining  numeric default 0;
alter table admin_commission add column if not exists close_rate numeric;          -- % 0-100, null = ชีทไม่มีค่า

-- ล้างข้อมูลชุดเก่า (รวมจากรายวัน — ตัวเลขคอมไม่ตรงเงื่อนไขจริง) ให้ sync รอบใหม่เติมเต็ม
truncate table admin_commission;
