-- ============================================================
-- PN Infinity — Pancake Dashboard (Postgres schema for Supabase)
-- รันไฟล์นี้ใน Supabase: Dashboard → SQL Editor → วาง → Run
-- (port จากโครงชีตเดิมใน Config.gs แต่เพิ่ม index ให้ query เร็ว)
-- ============================================================

-- ---------- เพจ FB/LINE ----------
create table if not exists pages (
  page_id      text primary key,
  name         text default '',
  platform     text default 'facebook',
  in_pos_shop  text default '',
  has_token    boolean default false,
  updated_at   timestamptz default now()
);

-- page_access_token ของแต่ละเพจ (แทน Script Properties เดิม) — เก็บแยกกันความลับ
create table if not exists page_tokens (
  page_id text primary key references pages(page_id) on delete cascade,
  token   text not null,
  updated_at timestamptz default now()
);

-- ---------- ออเดอร์ POS ----------
create table if not exists orders (
  id             text primary key,
  display_id     text default '',
  status         int,
  status_name    text default '',
  inserted_at    timestamptz,
  updated_at     timestamptz,
  total_price    numeric default 0,
  cod            numeric default 0,
  transfer_money numeric default 0,
  shipping_fee   numeric default 0,
  total_discount numeric default 0,
  items_count    int default 0,
  product_names  text default '',
  items_json     jsonb,
  seller_id      text default '',
  seller_name    text default '',
  creator_id     text default '',
  creator_name   text default '',
  marketer_name  text default '',
  customer_id    text default '',
  customer_name  text default '',
  page_id        text default '',
  platform       text default 'facebook',
  post_id        text default '',
  ad_id          text default '',
  conversation_id text default '',
  ads_source     text default '',
  account_name   text default '',
  tags           text default ''
);
create index if not exists idx_orders_inserted on orders (inserted_at);
create index if not exists idx_orders_updated  on orders (updated_at);
create index if not exists idx_orders_page      on orders (page_id);
create index if not exists idx_orders_ad         on orders (ad_id);
create index if not exists idx_orders_status     on orders (status);

-- ---------- สถิติแชทรายชั่วโมง/เพจ ----------
create table if not exists chat_hourly (
  key                    text primary key,
  page_id                text,
  page_name              text,
  platform               text,
  date                   date,
  hour                   int,
  new_customer_count     int default 0,
  new_inbox_count        int default 0,
  customer_inbox_count   int default 0,
  customer_comment_count int default 0,
  page_inbox_count       int default 0,
  page_comment_count     int default 0,
  inbox_interactive_count int default 0,
  phone_number_count     int default 0,
  uniq_phone_number_count int default 0,
  updated_at             timestamptz default now()
);
create index if not exists idx_chat_date on chat_hourly (date);
create index if not exists idx_chat_page on chat_hourly (page_id);

-- ---------- บทสนทนา (ใครรอตอบ) ----------
create table if not exists conversations (
  id             text primary key,
  page_id        text,
  page_name      text,
  platform       text,
  type           text,
  customer_name  text,
  snippet        text,
  message_count  int default 0,
  inserted_at    timestamptz,
  updated_at     timestamptz,
  last_sent_by   text,
  last_admin_name text,
  waiting        boolean default false,
  has_phone      boolean default false,
  tags           text,
  assignees      text,
  ad_ids         text,
  seen           boolean default false
);
create index if not exists idx_conv_updated on conversations (updated_at);
create index if not exists idx_conv_waiting on conversations (waiting);

-- ---------- สถิติแอดมินรายวัน/เพจ ----------
create table if not exists admin_chat_daily (
  key                 text primary key,
  date                date,
  page_id             text,
  page_name           text,
  user_id             text,
  user_name           text,
  inbox_count         int default 0,
  comment_count       int default 0,
  unique_inbox_count  int default 0,
  private_reply_count int default 0,
  phone_number_count  int default 0,
  avg_response_ms     numeric default 0,
  updated_at          timestamptz default now()
);
create index if not exists idx_acd_date on admin_chat_daily (date);
create index if not exists idx_acd_user on admin_chat_daily (user_id);

-- ---------- รายชื่อแอดมิน + สถานะออนไลน์ ----------
create table if not exists admins (
  user_id       text primary key,
  pos_user_id   text default '',
  name          text default '',
  email         text default '',
  fb_id         text default '',
  is_online     boolean default false,
  status_in_page text default '',
  pages         text default '',
  page_count    int default 0,
  permissions   text default '',
  department    text default '',
  sale_group    text default '',
  avatar_url    text default '',
  updated_at    timestamptz default now()
);

-- ---------- แอด (Ads Manager) ----------
create table if not exists ads (
  ad_id            text primary key,
  name             text default '',
  status           text default '',
  effective_status text default '',
  objective        text default '',
  campaign_id      text default '',
  campaign_name    text default '',
  adset_id         text default '',
  ad_account_id    text default '',
  ad_account_name  text default '',
  currency         text default 'THB',
  spend            numeric default 0,
  impressions      numeric default 0,
  reach            numeric default 0,
  clicks           numeric default 0,
  ctr              numeric default 0,
  cpm              numeric default 0,
  msgs_started     numeric default 0,
  cost_per_msg     numeric default 0,
  order_created    numeric default 0,
  order_shipped    numeric default 0,
  marketer_name    text default '',
  created_time     timestamptz,
  start_time       timestamptz,
  updated_at       timestamptz default now()
);

-- ---------- log การ sync ----------
create table if not exists sync_log (
  id      bigint generated always as identity primary key,
  ts      timestamptz default now(),
  job     text,
  ok      boolean,
  message text,
  ms      int
);
create index if not exists idx_synclog_ts on sync_log (ts desc);

-- ---------- key-value สำหรับ state/cursor (แทน Script Properties) ----------
create table if not exists sync_state (
  key   text primary key,
  value text,
  updated_at timestamptz default now()
);
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

-- v2: snapshot ตัวตนสำหรับ admin_settings (กัน seller ผีใน Admin Performance)
alter table admin_settings add column if not exists pos_user_id text default '';
alter table admin_settings add column if not exists snap_name   text default '';
-- ============================================================
-- Migration 2026-07-11 v3 — Sprint 2 (ลูกค้าเก่า + max_pending)
-- ============================================================

-- "ลูกค้าเก่า" — index ให้ค้นประวัติการซื้อของลูกค้ารายคนได้เร็ว
create index if not exists idx_orders_customer on orders (customer_id, inserted_at);

-- ฟังก์ชันนับลูกค้าเก่า: ลูกค้าในช่วงที่เลือกที่ "เคยมีออเดอร์" ในช่วง lookback
create or replace function sales_returning_customers(
  p_start    timestamptz,
  p_end      timestamptz,
  p_lookback timestamptz,
  p_channel  text default '',
  p_excluded int[] default array[4, 5, 6, 7, 15]
) returns table (total_customers bigint, returning_customers bigint)
language sql stable as $$
  with cur as (
    select distinct customer_id
    from orders
    where inserted_at >= p_start and inserted_at <= p_end
      and coalesce(customer_id, '') <> ''
      and not (coalesce(status, 0) = any (p_excluded))
      and (p_channel = '' or
        (case when lower(coalesce(platform, '')) = 'line' then 'line'
              when lower(coalesce(platform, '')) in ('facebook', 'instagram', 'messenger', '') then 'facebook'
              else 'other' end) = p_channel)
  )
  select
    (select count(*) from cur) as total_customers,
    (select count(*) from cur c where exists (
       select 1 from orders o
       where o.customer_id = c.customer_id
         and o.inserted_at >= p_lookback and o.inserted_at < p_start
         and not (coalesce(o.status, 0) = any (p_excluded))
    )) as returning_customers
$$;

-- เพดาน "แชทรอตอบ" ต่อแอดมิน (หน้า Admin Management) — 0 = ไม่กำหนด
alter table admin_settings add column if not exists max_pending int default 0;
