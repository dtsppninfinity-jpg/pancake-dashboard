-- ============================================================
-- Migration 2026-07-29 — สินค้าตีกลับ (returns) จาก Google Sheets ของทีม
-- รันใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run  (ปลอดภัย รันซ้ำได้)
--
-- ทำไมต้องดึงจาก Sheets ไม่ใช่ Pancake:
--   Pancake /orders_returned ของร้านนี้ว่างเปล่า 0 ใบ — ทีมไม่ได้เดินสถานะคืนสินค้าในระบบ
--   ของจริงบันทึกมือในชีทรายเดือน "📦สรุปตีกลับ <เดือน>.69 (Admin , CRM) PN8"
--   (ก.ค. 69 = 1,913 ออเดอร์ ฿917,281 — มากกว่าจำนวน "ยกเลิก" ในระบบเท่าตัว)
--
-- key = "<file_id>#<เลขแถว>" และงาน sync จะ "ลบทั้งไฟล์แล้วใส่ใหม่" ทุกรอบ
--   เพราะทีมแทรก/ลบแถวกลางตารางได้ตลอด การ upsert ทีละแถวจะเหลือขยะค้าง
-- ============================================================

create table if not exists returns (
  key              text primary key,      -- <file_id>#<row>
  file_id          text not null,         -- ไฟล์ Google Sheets ต้นทาง
  month            text not null,         -- 'YYYY-MM' ของเดือนที่รับตีกลับ
  order_date       date,
  ship_tracking    text default '',       -- เลขพัสดุขาออก
  customer         text default '',
  phone            text default '',
  return_date      date,                  -- วันที่รับตีกลับ
  return_tracking  text default '',       -- เลขพัสดุขากลับ
  product          text default '',
  price            numeric default 0,     -- บาทจริง (ชีทเก็บเป็นบาท ไม่ใช่สตางค์แบบ orders)
  qty              numeric default 0,
  staff            text default '',       -- ชื่อเล่นแอดมิน หรือ "CRMxxx"
  is_crm           boolean default false, -- staff ขึ้นต้นด้วย CRM = ฝ่าย CRM ไม่ใช่แอดมินขาย
  updated_at       timestamptz default now()
);

create index if not exists idx_returns_month  on returns (month);
create index if not exists idx_returns_staff  on returns (staff);
create index if not exists idx_returns_rdate  on returns (return_date);
create index if not exists idx_returns_file   on returns (file_id);
