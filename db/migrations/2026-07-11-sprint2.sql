-- ============================================================
-- Migration 2026-07-11 v3 — Sprint 2
-- รันไฟล์นี้ใน Supabase: Dashboard → SQL Editor → วาง → Run
-- (ปลอดภัย: if not exists / or replace — รันซ้ำได้ ไม่กระทบข้อมูลเดิม)
-- ============================================================

-- 1) "ลูกค้าเก่า" — index ให้ค้นประวัติการซื้อของลูกค้ารายคนได้เร็ว
create index if not exists idx_orders_customer on orders (customer_id, inserted_at);

-- 2) ฟังก์ชันนับลูกค้าเก่า: ลูกค้าในช่วงที่เลือกที่ "เคยมีออเดอร์" ในช่วง lookback
--    (นับฝั่ง Postgres — ถ้าดึงออเดอร์ 95 วันมานับใน API จะช้าเกินใช้งานจริง)
--    กติกา channel ตรงกับ platformChannel_ ฝั่งเว็บ: line | facebook(รวม ig/messenger/ว่าง) | other
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

-- 3) เพดาน "แชทรอตอบ" ต่อแอดมิน (หน้า Admin Management) — 0 = ไม่กำหนด
alter table admin_settings add column if not exists max_pending int default 0;
