-- 2026-07-23 — ตาราง chat_engagement_daily
--
-- ที่มา: GET /pages/{page_id}/statistics/customer_engagements
-- นี่คือ "แหล่งเดียวกับหน้าสถิติแชทของ Pancake" — ตัวเลขบนหน้าเว็บเราจะตรงกับที่บอสเห็น
--   total                 = ลูกค้าที่มีปฏิสัมพันธ์ทั้งหมด (inbox + comment, ตัดซ้ำแล้ว)
--   new_inbox             = ลูกค้าที่เปิดแชทใหม่ (customer_engagement_new_inbox)
--   new_customer_replied  = ลูกค้าใหม่ที่เพจตอบกลับ
--   order_count           = "สร้างคำสั่งซื้อ" ของ Pancake
--   old_order_count       = ออเดอร์จากลูกค้าเก่า
--
-- %ปิดการขายแบบ Pancake ("ยอดสั่งซื้อจากลูกค้าทั้งหมด") = order_count / total
--
-- ปลอดภัยที่จะรันซ้ำ (idempotent)

create table if not exists chat_engagement_daily (
  key                  text primary key,          -- "<page_id>|<date>"
  date                 date not null,
  page_id              text not null,
  page_name            text,
  platform             text,
  inbox                integer not null default 0,
  comment              integer not null default 0,
  total                integer not null default 0,
  new_customer_replied integer not null default 0,
  new_inbox            integer not null default 0,
  order_count          integer not null default 0,
  old_order_count      integer not null default 0,
  updated_at           timestamptz not null default now()
);

create index if not exists chat_engagement_daily_date_idx on chat_engagement_daily (date);
create index if not exists chat_engagement_daily_page_idx on chat_engagement_daily (page_id);
