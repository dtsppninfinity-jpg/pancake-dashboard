-- ============================================================
-- Migration 2026-07-11 — Admin Management upgrade
-- รันไฟล์นี้ใน Supabase: Dashboard → SQL Editor → วาง → Run
-- (ปลอดภัย: create if not exists — รันซ้ำได้ ไม่กระทบข้อมูลเดิม)
-- ============================================================

-- การตั้งค่าแอดมินที่ทีมแก้เองบน dashboard (แยกจากตาราง admins
-- เพราะ admins ถูก sync เขียนทับทั้งตารางทุกชั่วโมง — ตารางนี้ไม่โดนแตะ)
create table if not exists admin_settings (
  user_id         text primary key,      -- ตรงกับ admins.user_id
  enabled         boolean default true,  -- false = ปิดใช้งาน (ตัดออกจาก ranking/KPI)
  status_override text default '',       -- '' = อัตโนมัติจาก Pancake | 'away' = พัก | 'busy' = ไม่ว่าง
  role            text default '',       -- 1 ใน 7 role ('' = ยังไม่กำหนด)
  channels        text default 'both',   -- both | facebook | line
  product_groups  text default '',       -- กลุ่มสินค้าที่ดูแล (comma-separated)
  max_active      int default 600,        -- เพดานแชทที่ดูแลพร้อมกัน (ป้าย capacity)
  note            text default '',
  updated_at      timestamptz default now()
);

-- ประวัติการเปลี่ยนสถานะออนไลน์ (สำหรับ "ออนไลน์ X ชม. / หาย Y นาที" ของจริง)
-- sync เขียนเฉพาะตอนสถานะเปลี่ยน (ความละเอียด ~15 นาทีตามรอบ sync)
create table if not exists admin_online_log (
  id         bigserial primary key,
  user_id    text not null,
  is_online  boolean not null,
  changed_at timestamptz not null default now()
);
create index if not exists idx_aol_user_time on admin_online_log (user_id, changed_at);
create index if not exists idx_aol_time on admin_online_log (changed_at);

-- v2: snapshot ตัวตน (pos id + ชื่อ) ณ ตอนบันทึกตั้งค่า — ให้ Admin Performance
-- กันยอดขายของคนที่ "ปิดใช้งานแล้วออกจากทีม" โผล่กลับเข้า ranking เป็นแถวไร้ชื่อ
alter table admin_settings add column if not exists pos_user_id text default '';
alter table admin_settings add column if not exists snap_name   text default '';
