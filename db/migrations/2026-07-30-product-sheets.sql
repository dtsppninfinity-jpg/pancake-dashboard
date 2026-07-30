-- ============================================================
-- Migration 2026-07-30 — ยอด/กำไรรายวันต่อยูนิต + ค่าคอมแอดมิน (จากชีทสรุปรายสินค้า)
-- รันใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run  (ปลอดภัย รันซ้ำได้)
--
-- ที่มา: โฟลเดอร์ "สรุปยอดรายสินค้า" 1 ไฟล์ = 1 ยูนิต (`สร. UN3 : ดวงดรุณี 69`)
--   • แท็บ `สรุปยอดขาย`  → รายวัน: ยอดขาย / ออเดอร์ / ค่าแอด / **กำไรสุทธิ** / %มาร์จิ้น
--   • แท็บ `Com:Admin`   → รายเดือน × แอดมิน: ยอดขาย + ค่าคอม (@ / รองหัวหน้า / หัวหน้า)
--
-- ทำไมสำคัญ: `กำไรสุทธิ` ในชีทหักต้นทุนสินค้าและสำรองตีกลับมาแล้ว
--   ซึ่งเป็นตัวเลขที่ระบบเราคำนวณเองไม่ได้ (ต้นทุน SKU ใน POS เป็น 0 ทุกตัว)
--   ทำให้ทำ "เช็คกำไรรายวัน" และ "แจ้งเตือนยูนิตขาดทุนจากกำไรจริง" ได้เป็นครั้งแรก
-- ============================================================

create table if not exists unit_daily (
  key         text primary key,     -- '<u>|<date>'
  u           text not null,
  date        date not null,
  file_id     text default '',
  sales       numeric default 0,    -- ยอดรวม (บาทจริง — ชีทเก็บเป็นบาท ไม่ใช่สตางค์)
  orders      numeric default 0,
  ads         numeric default 0,    -- ค่าแอดที่ทีมกรอกในชีท (คนละตัวกับ ad_daily ของ Meta)
  profit      numeric default 0,    -- กำไรสุทธิ — หักต้นทุน + สำรองตีกลับแล้ว
  margin      numeric default 0,    -- สัดส่วนกำไร (0.12 = 12%)
  updated_at  timestamptz default now()
);
create index if not exists idx_unit_daily_date on unit_daily (date);
create index if not exists idx_unit_daily_u    on unit_daily (u);

create table if not exists admin_commission (
  key         text primary key,     -- '<u>|<month>|<admin>'
  u           text not null,
  month       text not null,        -- 'YYYY-MM'
  admin       text not null,        -- ชื่อเล่นแอดมิน (ชีทใช้ชื่อเล่นเป็นตัวระบุตัวตน)
  sales       numeric default 0,
  com         numeric default 0,    -- ค่าคอมของแอดมินคนนี้
  com_sub     numeric default 0,    -- ค่าคอมส่วนรองหัวหน้า
  com_head    numeric default 0,    -- ค่าคอมส่วนหัวหน้า
  updated_at  timestamptz default now()
);
create index if not exists idx_admin_com_month on admin_commission (month);
create index if not exists idx_admin_com_admin on admin_commission (admin);
create index if not exists idx_admin_com_u     on admin_commission (u);
