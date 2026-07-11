---
name: pancake-api
description: ความรู้ Pancake POS Open API + pages.fm API ทั้งระบบ — อะไรอ่านได้/เขียนได้/ทำไม่ได้ + roadmap สร้างระบบแชทของเราเอง ใช้ทุกครั้งที่ทำงานเกี่ยวกับ Pancake API, sync, webhook, การส่งข้อความ, จัดการแอดมิน หรือวางแผนฟีเจอร์ใหม่
---

# Pancake API — ความสามารถจริงทั้งหมด (ยืนยันจาก OpenAPI spec ทางการ, วิจัย 2026-07-11)

Spec ทางการดาวน์โหลดไว้ที่ `refs/` ในโฟลเดอร์นี้: `pos-openapi.json` (85 paths), `pages-openapi.yaml`, `pages-webhook.yaml` — เปิดดูได้เลยเมื่อต้องการรายละเอียด endpoint/พารามิเตอร์เป๊ะๆ

## ⚡ ข้อเท็จจริงชี้ขาด (ห้ามลืม)

1. **จัดการแอดมิน (สร้าง/แก้/ปิดใช้งาน/เปลี่ยนสิทธิ์) ทำผ่าน public API ไม่ได้เด็ดขาด** — ยืนยันจาก spec ทั้งสองตัว (สแกน keyword ครบ = 0 endpoint) ปุ่มพวกนี้ใน UI Pancake ใช้ private API ภายใน "แอดมิน" คือ user ใน DB ของ Pancake เอง (Pancake ID/FB OAuth) — FB/LINE ไม่รู้จักแอดมินพวกนี้เลย
2. **แต่ "อ่าน" ได้ละเอียด:** `GET /pages/{id}/users` คืน users[] + **disabled_users[]** + permission codes (ตัวเลข เช่น [100,71,81]) + is_online
3. **ส่งข้อความผ่าน API ได้จริง!** (pages.fm): `reply_inbox` (text/media), `reply_comment` (+mentions), `private_replies` (FB/IG) — ระบุ `sender_id` เพื่อเครดิตเป็นแอดมินรายคนได้ ⚠️ ส่งได้เฉพาะใน conversation ที่มีอยู่แล้ว (cold-start FB/LINE ไม่ได้)
4. **จัดการแชทผ่าน API ได้:** `assign` (มอบหมายแชทให้แอดมิน), tag add/remove (แต่**สร้าง** tag ใหม่ไม่ได้), read/unread, `POST /round_robin_users` (ตั้งใครอยู่ในคิวรับแชทอัตโนมัติ — ใกล้เคียง "พักงาน" ที่สุดที่ API ให้)
5. **POS webhook ตั้งเองได้** (self-service): `PUT /shops/{SHOP_ID}` ตั้ง webhook_url + types (orders/customers/products/variations_warehouses/CRM) → real-time แทน polling ได้
6. **pages.fm webhook (แชท real-time) ต้องติดต่อ Pancake support เปิดให้** — ไม่ self-service; endpoint ต้องตอบ <5 วิ, idempotent, error >80% โดน auto-suspend
7. **0 DELETE endpoint** ทั้ง POS API (ยกเว้น `delete_multi` ของ voucher ผ่าน POST และ DELETE customer notes ฝั่ง pages)
8. auth: POS = `api_key` query param + shop_id | pages.fm = `access_token` (ของบัญชี, หมดอายุ ~90 วัน) / `page_access_token` (มิ้นต์ผ่าน `POST generate_page_access_token`) | rate limit pages.fm ≈ 5 req/s/เพจ
9. ⚠️ แหล่งปลอม: repo `svn4pro/pancake-pos-mcp` อ้าง employee CRUD ที่**ไม่มีจริง** — ห้ามอ้างอิง

## 📋 Write ทั้งหมดที่ทำได้วันนี้ (สรุป)

ส่งข้อความ/รูป/private reply • assign แชท • tag/untag • read/unread • ตั้ง round-robin • แก้โปรไฟล์+โน้ตลูกค้า (notes CRUD เต็ม) • สร้าง/แก้ order (รวมสถานะ, arrange_shipment, print label, return) • สร้าง/แก้/ซ่อนสินค้า + update_quantity • warehouse ops ครบ • โปรโมชั่น/voucher • POST adv_costs (บันทึกค่าแอด) • CRM tables • ตั้ง POS webhook

**ทำไม่ได้:** จัดการแอดมินทุกรูปแบบ • สร้าง tag ใหม่ • ซ่อน/ลบคอมเมนต์ • ลบ order/สินค้า • เปิด pages.fm webhook เอง • เริ่มแชทใหม่ (cold outreach)

## 🗺️ Roadmap "Pancake ของเราเอง" (เห็นชอบร่วมกับ user แล้ว — ดู memory project-vision)

- **Phase 0 (S):** เสริม dashboard — sync disabled_users + permission codes, ตั้ง POS webhook, token health-check (access_token หมดอายุ ~90 วัน ไม่มี auto-refresh!)
- **Phase 1 (M):** Chat console เกาะ Pancake API — อ่าน/ส่ง/assign/tag ผ่าน API + ขอ support เปิด webhook
- **Phase 2 (M):** User/Role layer ของเราเอง (เริ่มแล้ว: ตาราง `admin_settings`) — "ปิดใช้งาน" เวอร์ชันเรา = flag เรา + ถอด round-robin + assign แชทออก
- **Phase 3 (L):** ต่อ FB Messenger Platform ตรง — **Standard Access ไม่ต้อง App Review ถ้าใช้กับเพจตัวเอง** (internal tool path!), หน้าต่าง 24 ชม. + HUMAN_AGENT tag (7 วัน), รันคู่ Pancake ได้ (multi-app + Handover Protocol), ดึงประวัติย้อนหลังได้
- **Phase 4 (L):** LINE Messaging API — **webhook เดียวต่อ channel** (รันคู่ Pancake ไม่ได้ ต้องสลับ/ทำ relay), ไม่มี history API, push เกินโควตาเสียเงิน (แพลนไทย ~300 ฟรี/เดือน — เช็คราคาปัจจุบันก่อน)
- **Phase 5 (XL):** แทนที่เต็มตัว — พิจารณา Chatwoot (self-hosted, มี FB+LINE channel ทางการ) เป็นฐานแทน build from scratch

## ที่โค้ดเราใช้อยู่ (lib/pancake.ts)

- `POS_BASE = pos.pages.fm/api/v1` | `PAGES_BASE = pages.fm/api/v1` | `PUBLIC_V1/V2 = pages.fm/api/public_api/v{1,2}`
- ใช้แค่ read: orders, users(POS), ads_manager, pages, page users, conversations, statistics + POST generate_page_access_token
- ช่องโหว่ที่รู้: posFetchUsers ดึงหน้าเดียว (cap 200 คน), pageConversations cap ~180/รอบ, ไม่มี token auto-refresh, ไม่มี webhook receiver

## Sources ทางการ

- POS: https://api-docs.pancake.vn/ (+ /openapi.json)
- pages.fm: https://developer.pancake.biz/ (+ /openapi/openapi.yaml, /openapi/webhook.yaml)
- Docs: docs.pancake.biz, docs.pancake.vn, docs.pos.pages.fm
- FB: developers.facebook.com Messenger Platform | LINE: developers.line.biz Messaging API
