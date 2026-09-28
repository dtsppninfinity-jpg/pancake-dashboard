-- ============================================================
-- Migration 2026-09-28 — ให้ฐานข้อมูลรวมยอดแชท/บทสนทนาของหน้า "ภาพรวมแชท" เอง
-- รันไฟล์นี้ใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- (ปลอดภัย: ไม่แตะตาราง ไม่แตะข้อมูล แค่เพิ่มฟังก์ชันอ่านอย่างเดียว 2 ตัว · รันซ้ำได้)
-- ============================================================
--
-- ทำไม: หน้าภาพรวมแชทเป็นหน้าแรกของเว็บ และรีเฟรชเองทุก 5 นาทีต่อทุกแท็บที่เปิดค้าง
-- เดิมทุกครั้งลากแถวดิบมารวมในเว็บ: chat_hourly 7-14 วัน (~1-2 หมื่นแถว) + conversations 24 ชม. (~1 หมื่นแถว)
-- ≈ 2 MB ต่อครั้ง (กิน egress ที่เกินโควตา) · รวมในฐานแล้วเหลือไม่กี่สิบ KB
--
-- ก่อนรัน: หน้าเว็บยังทำงานแบบเดิมทุกอย่าง (หาฟังก์ชันไม่เจอ = ถอยไปอ่านแถวดิบเอง) ตัวเลขเหมือนกันทั้งสองทาง
-- ลำดับ "เจอก่อน" (เพจ/ประเภท/แท็กที่ค่าเท่ากัน) คืนมาเรียงตาม id แบบเดียวกับที่เว็บเคยเรียงแถว

-- ---------- 1) แชทรายวันต่อ platform (แทนแถวรายชั่วโมงทั้งช่วง) ----------
create or replace function dash_chat_daily(
  p_from date,
  p_to   date
) returns table (
  d date,
  platform text,
  customer_inbox_count bigint,
  customer_comment_count bigint,
  page_inbox_count bigint,
  page_comment_count bigint,
  new_inbox_count bigint,
  new_customer_count bigint,
  uniq_phone_number_count bigint
)
language sql stable as $$
  select
    h.date                                        as d,
    h.platform                                    as platform,
    sum(coalesce(h.customer_inbox_count, 0))      as customer_inbox_count,
    sum(coalesce(h.customer_comment_count, 0))    as customer_comment_count,
    sum(coalesce(h.page_inbox_count, 0))          as page_inbox_count,
    sum(coalesce(h.page_comment_count, 0))        as page_comment_count,
    sum(coalesce(h.new_inbox_count, 0))           as new_inbox_count,
    sum(coalesce(h.new_customer_count, 0))        as new_customer_count,
    sum(coalesce(h.uniq_phone_number_count, 0))   as uniq_phone_number_count
  from chat_hourly h
  where h.date >= p_from and h.date <= p_to
  group by h.date, h.platform
  order by h.date, h.platform
$$;

-- ---------- 2) บทสนทนา 24 ชม. แบบนับกลุ่ม (แทนแถวดิบทุกบทสนทนา) ----------
-- groups: นับต่อ (ชื่อเพจ, platform, ประเภท, รอตอบ, บอตตอบล่าสุด) เรียงตาม id แรกของกลุ่ม
-- tags  : นับต่อ (แท็กดิบก่อนตัดช่องว่าง, platform, ประเภท) เรียงตามจุดที่เจอครั้งแรก (id, ลำดับในช่องแท็ก)
-- คืนเป็น json ก้อนเดียว — ไม่โดนเพดาน 1,000 แถวของ PostgREST
create or replace function dash_conv_24h(
  p_cutoff timestamptz
) returns json
language sql stable as $$
  with c as (
    select id, page_name, platform, type,
           coalesce(waiting, false)            as waiting,
           coalesce(last_sent_by = 'ai', false) as is_ai,
           tags
    from conversations
    where updated_at >= p_cutoff
  ),
  g as (
    select page_name, platform, type, waiting, is_ai, count(*) as n, min(id) as first_id
    from c
    group by page_name, platform, type, waiting, is_ai
  ),
  t as (
    select c.id, c.platform, c.type, x.tag, x.ord
    from c
    cross join lateral unnest(string_to_array(coalesce(c.tags, ''), ',')) with ordinality as x(tag, ord)
  ),
  s as (
    select tag, platform, type, row_number() over (order by id, ord) as seq
    from t
  ),
  tg as (
    select tag, platform, type, count(*) as n, min(seq) as first_seq
    from s
    group by tag, platform, type
  )
  select json_build_object(
    'groups', coalesce((
      select json_agg(json_build_object(
        'page_name', page_name, 'platform', platform, 'type', type,
        'waiting', waiting, 'ai', is_ai, 'n', n) order by first_id)
      from g), '[]'::json),
    'tags', coalesce((
      select json_agg(json_build_object(
        'tag', tag, 'platform', platform, 'type', type, 'n', n) order by first_seq)
      from tg), '[]'::json)
  )
$$;
