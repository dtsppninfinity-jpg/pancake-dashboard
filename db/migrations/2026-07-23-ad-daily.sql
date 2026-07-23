-- ============================================================
-- Migration 2026-07-23 — ค่าแอดจริงรายวัน (ad_daily)
-- รันใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run  (ปลอดภัย รันซ้ำได้)
--
-- ทำไมต้องมีตารางใหม่:
--   ตาราง `ads` เดิมดึงจาก POS /ads_manager/ads_v2 ซึ่ง "คืน 0 แถวเสมอ" (ตรวจแล้ว 9 รูปแบบ
--   พารามิเตอร์) ตารางเลยว่างมาตลอด → ROAS/ค่าแอดบนหน้าเว็บไม่มีข้อมูลจริงรองรับ
--   ของจริงอยู่ที่ pages API: GET /pages/{page_id}/statistics/ads?type=by_id
--   ให้ spend / impressions / reach / clicks / ctr / cpm / สถานะแอด ครบ (currency THB)
--
--   ตารางนี้เก็บ "รายวัน x รายแอด" เพื่อให้เลือกช่วงวันที่แล้วรวมยอดได้ถูกต้อง
--   (ตาราง ads เดิมเก็บยอดสะสมค่าเดียว เลยทำ ROAS ตามช่วงไม่ได้)
-- ============================================================

create table if not exists ad_daily (
  date              date not null,
  ad_id             text not null,
  page_id           text default '',
  page_name         text default '',
  name              text default '',
  status            text default '',      -- ACTIVE / PAUSED / ...
  account_id        text default '',
  currency          text default 'THB',
  spend             numeric default 0,    -- บาทจริง (มีทศนิยม — ไม่ใช่สตางค์เหมือน orders)
  impressions       numeric default 0,
  reach             numeric default 0,
  clicks            numeric default 0,
  link_clicks       numeric default 0,
  ctr               numeric default 0,
  cpm               numeric default 0,
  msgs_started      numeric default 0,    -- messaging_conversation_started_7d
  first_replies     numeric default 0,    -- messaging_first_reply
  phones            numeric default 0,    -- sum_phone_number
  pos_orders        numeric default 0,    -- ออเดอร์ที่ Pancake ผูกกับแอดนี้เอง (ไว้เทียบกับของเรา)
  optimization_goal text default '',
  daily_budget      numeric default 0,
  budget_remaining  numeric default 0,
  updated_at        timestamptz default now(),
  primary key (date, ad_id)
);

create index if not exists idx_ad_daily_date on ad_daily (date);
create index if not exists idx_ad_daily_ad   on ad_daily (ad_id);
create index if not exists idx_ad_daily_page on ad_daily (page_id);
