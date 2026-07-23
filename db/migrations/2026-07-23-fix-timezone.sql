-- ============================================================
-- Migration 2026-07-23 — แก้เวลาเพี้ยน 7 ชั่วโมง (orders + conversations)
-- รันใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run
--
-- ปัญหา: โค้ด sync เดิมเติม "+07:00" ให้ timestamp ของ Pancake ที่ไม่มีโซนต่อท้าย
--        แต่ POS /orders กับ pages /conversations ส่งมาเป็น "UTC"
--        (พิสูจน์: ยิง API ตอน UTC 06:00:00 ได้ค่า '2026-07-23T06:00:02')
--        ทุกแถวจึงถูกบันทึกเร็วไป 7 ชม. → กราฟยอดขายพีคตอนตี 2-4 ซึ่งเป็นไปไม่ได้
--        และออเดอร์ช่วง 00:00-07:00 น. ไทย ถูกนับเป็น "เมื่อวาน"
--
-- ⚠️ ห้ามรันซ้ำ! ถ้ารัน 2 ครั้งข้อมูลจะเลื่อนไป 14 ชม.
--    สคริปต์นี้กันไว้แล้วด้วยมาร์กใน sync_state — รันซ้ำจะข้ามเองและแจ้งเตือน
--
-- หมายเหตุ: ตาราง chat_hourly กับ admin_chat_daily "ไม่ต้องแก้"
--           statistics/pages ส่ง label ชั่วโมงเป็นเวลาไทยอยู่แล้ว (ตรวจแล้ว)
-- ============================================================

do $$
declare
  already text;
  n_orders bigint;
  n_convs  bigint;
begin
  select value into already from sync_state where key = 'tz_fix_2026_07_23';
  if already is not null then
    raise notice 'ข้ามการแก้เวลา — เคยรันไปแล้วเมื่อ %', already;
    return;
  end if;

  update orders
     set inserted_at = inserted_at + interval '7 hours',
         updated_at  = updated_at  + interval '7 hours';
  get diagnostics n_orders = row_count;

  update conversations
     set inserted_at = inserted_at + interval '7 hours',
         updated_at  = updated_at  + interval '7 hours';
  get diagnostics n_convs = row_count;

  insert into sync_state (key, value, updated_at)
  values ('tz_fix_2026_07_23', now()::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  raise notice 'เลื่อนเวลา +7 ชม. แล้ว: orders % แถว, conversations % แถว', n_orders, n_convs;
end $$;

-- ตรวจผล: ค่าสูงสุดควรใกล้เวลาปัจจุบัน (ไม่ใช่ถอยหลัง 7 ชม.)
select 'orders'        as tbl, max(inserted_at) as latest, now() as now_utc from orders
union all
select 'conversations' as tbl, max(updated_at)  as latest, now()            from conversations;
