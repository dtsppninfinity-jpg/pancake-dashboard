-- ออเดอร์จากร้าน Pancake POS ฝั่งลาว (ขายเป็นเงินกีบ LAK) — แยกตารางจาก orders โดยตั้งใจ
--
-- ทำไมไม่ใส่ตาราง orders เดิม:
--   ทุกตัวเลขยอดขายในระบบ (RPC รายวัน/รายเพจ, ผลงานแอดมิน, กำไร, รายงาน) บวก total_price ตรงๆ เป็น "บาท"
--   ถ้าออเดอร์กีบปนเข้าไป 1,010,000 ₭ จะกลายเป็น ฿1,010,000 ทุกหน้า
--   และเลข id ออเดอร์เป็นลำดับต่อร้าน — สองร้านชนกันได้
--
-- total_price เก็บ "ค่าดิบ" ตามที่ POS ส่งมา (เหมือน orders) — หน้าเว็บหารด้วย LAK_MONEY_SCALE ตอนอ่าน
-- รัน 1 ครั้งใน Supabase → SQL Editor
create table if not exists orders_laos (
  id            text primary key,
  shop_id       text default '',
  currency      text default '',
  display_id    text default '',
  status        int,
  status_name   text default '',
  inserted_at   timestamptz,
  updated_at    timestamptz,
  total_price   numeric default 0,
  items_count   int default 0,
  product_names text default '',
  customer_id   text default '',
  page_id       text default '',
  platform      text default 'facebook',
  ad_id         text default ''
);
create index if not exists idx_orders_laos_inserted on orders_laos (inserted_at);

-- ตารางนี้อ่านจากฝั่งเซิร์ฟเวอร์ด้วย service role เท่านั้น (เหมือนตารางอื่นในระบบ)
alter table orders_laos enable row level security;
