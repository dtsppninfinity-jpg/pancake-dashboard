-- ============================================================
-- Migration 2026-07-27 — สื่อ/ครีเอทีฟของแอด (ad_creative)
-- รันใน Supabase: Dashboard → SQL Editor → วางทั้งไฟล์ → Run  (ปลอดภัย รันซ้ำได้)
--
-- ทำไมต้องเป็นตารางใหม่ ไม่ยัดลง ad_daily:
--   ครีเอทีฟ (รูป/คลิป/ลิงก์โพสต์) ไม่เปลี่ยนรายวัน — ถ้าเก็บใน ad_daily จะซ้ำทุกวัน
--   ต่อ 1 แอด (90 วัน = 90 แถวเก็บ URL ยาวๆ ชุดเดิม) เปลืองและ prune แล้วรูปหายด้วย
--   ตารางนี้ pk = ad_id ตัวเดียว → join กับ ad_daily ต่อ ad_id บนหน้า Content & Ads
--
-- แหล่งข้อมูล: Meta Graph API node Ad → field `creative` (เอกพจน์)
--   GET /v21.0/act_{account_id}/ads?fields=id,name,account_id,creative{...}
--   (edge /adcreatives ใช้ไม่ได้ — ไม่คืน ad_id เลย join กลับไม่ได้)
-- ============================================================

create table if not exists ad_creative (
  ad_id        text primary key,
  account_id   text default '',
  name         text default '',      -- ชื่อครีเอทีฟ (มักเป็นพาดหัว/ข้อความโพสต์) ไม่ใช่ชื่อแอด
  thumb_url    text default '',      -- thumbnail_url ขอไว้ที่ 600x600 (ค่า default ของ Meta คือ 64x64)
  image_url    text default '',      -- รูปคมสุดที่หาได้: image_url → link_data.picture → video_data.image_url → asset_feed_spec
  video_id     text default '',      -- มีค่า = ครีเอทีฟเป็นวิดีโอ (เล่นผ่าน facebook plugin ได้)
  object_type  text default '',      -- VIDEO / SHARE / PHOTO / ...
  post_id      text default '',      -- {page_id}_{post_id} จาก effective_object_story_id (ครอบคลุม dark post)
  permalink    text default '',      -- https://www.facebook.com/{post_id}
  ig_permalink text default '',      -- instagram_permalink_url (ถ้ายิงลง IG ด้วย)
  cta          text default '',      -- call to action เช่น MESSAGE_PAGE
  link_url     text default '',      -- ลิงก์ปลายทางของแอด (ถ้าไม่ใช่แอดทักแชท)
  updated_at   timestamptz default now()
);

create index if not exists idx_ad_creative_account on ad_creative (account_id);
create index if not exists idx_ad_creative_updated on ad_creative (updated_at);
