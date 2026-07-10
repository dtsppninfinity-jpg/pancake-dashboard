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
