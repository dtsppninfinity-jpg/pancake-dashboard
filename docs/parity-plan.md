<!-- แผน parity 5 หน้า vs mockup AI-Pancake-Chat-Automation — สร้าง 2026-07-11
     จาก gap analysis 5 คู่หน้า (89 gaps) + adversarial synthesis
     A = ทำได้เลย (ข้อมูลจริงมี) | B = ดัดแปลง | C = ทำไม่ได้ตอนนี้ (บอกเหตุผล+เฟสปลดล็อก) -->

# แผนสร้าง Prototype Parity — 5 หน้า (Dashboard / Sales / Content&Ads / Admin Mgmt / Admin Perf)

> หลักการ: **ข้อมูลจริงต้องไม่ถูกปลอมให้เหมือน mock** — จุดที่เราเหนือกว่า prototype (skeleton/SWR, tooltip, CSV กัน injection, timeline จริง, แผงปรับเกณฑ์คะแนน) ให้**คงไว้ทั้งหมด** แผนนี้เติมเฉพาะส่วนที่ขาด
> Effort: S = ≤ ครึ่งวัน, M = 0.5–1.5 วัน, L = หลายวัน/ต้องมี phase ใหม่

---

## 1) ตาราง Gap รายหน้า (เรียงตามลำดับที่ควรทำ)

### 1.1 Dashboard (ภาพรวมแชทวันนี้) — `lib/views/dashboard.ts`, `lib/api/dashboard.ts`

| # | Gap | Tag | Effort | หมายเหตุ |
|---|-----|-----|--------|----------|
| 1 | การ์ด "🤖 ตอบอัตโนมัติ (24 ชม.)" จาก `last_sent_by==='ai'` + % ต่อ conv | B | S | ใช้ค่า donut.ai ที่มีแล้ว — ไม่แตะ sync |
| 2 | ชิปกรอง 💭 Page Comment (`type='COMMENT'` + คู่ `*_comment_count`) | B | S | |
| 3 | badge "ด่วน" เมื่อ waitMins ≥ 60 ในรายการรอแอดมิน | B | S | กติกา derive เอง |
| 4 | แก้ string/สีปลีกย่อย (หัวการ์ด, สีโดนัท, ป้ายชิป) | A | S | **คงป้าย "(24 ชม.)"** และไม่ลอกท่อน "AI จัดการได้หมด" |
| 5 | จุดสีหน้าแท็ก (hash ชื่อแท็ก → palette คงที่) | B | S | ทำเป็น helper กลาง — ใช้ซ้ำได้ทุกหน้า |
| 6 | client polling refetch ทุก 2–5 นาที | B | S | โครง fetchAndRender+reqSeq รองรับแล้ว |
| 7 | คลิกรายการรอแอดมิน → deep-link เปิดใน Pancake web | B | S | **ต้อง verify รูปแบบ URL Pancake ก่อน** |
| 8 | ชิป 💬 Messenger แยกจาก Facebook | B | S | **เช็ค distinct ค่า platform ใน Supabase ก่อน** — ถ้าไม่แยกจริง ตัดทิ้ง |
| 9 | การ์ด "คอมเมนต์แยกตามเพจ" (คู่กับแชทแยกตามเพจ ให้ layout 2 คอลัมน์แบบ prototype) | B | S | ตัวแทน section Product Code ที่ไม่มีข้อมูล |
| 10 | custom tooltip บน svgWeekBars (แทน native `<title>`) | A | M | ขยาย bindChartTips ที่มีอยู่ — ใช้ซ้ำที่หน้า Admin Perf ด้วย |
| 11 | สไตล์แท่งซ้อนทับแบบ prototype | A | S | **เสนอไม่ทำ** — แท่งคู่อ่านง่ายกว่า, ถาม boss ถ้าอยากเป๊ะ |
| — | ปักหมุด / การ์ด KB / Intent / section Products / ชิป Reels / ชิป Ads Inbox | C | — | ดูข้อ 3 (รายการ C) |

### 1.2 Sales — `lib/views/sales.ts`, `lib/api/sales.ts` (โครงตรง prototype ACTIVE เกือบ 1:1 แล้ว)

| # | Gap | Tag | Effort | หมายเหตุ |
|---|-----|-----|--------|----------|
| 1 | ปุ่ม ⟳ โหลดใหม่ | A | S | เรียก refetch เดิม |
| 2 | Compare "ก่อน 7 วัน / ก่อน 30 วัน" | A | S | date math ใน resolveRange_ |
| 3 | ปุ่ม Export Excel (.xls) | A | S | ใช้ **downloadXLS helper กลาง** (สร้างครั้งเดียว ใช้ 2 หน้า) |
| 4 | ปุ่ม "ดูรายละเอียด" → drilldown modal Top5 เพจ + Top5 สินค้า ต่อ channel | A | M | ต้อง **ขยาย select ใน loadOrders_** (page_id/account_name/items_json) — infra ร่วมกับข้อ 6 และ Content&Ads |
| 5 | Channel select dropdown ใน header | A | S | ซ้ำซ้อนกับกล่องคลิก — ทำท้ายๆ หรือข้าม |
| 6 | [LEGACY] hbar ยอดขายตามสินค้า + ตามเพจ Top10 บนหน้า | A | M | ใช้ aggregation เดียวกับ drilldown ข้อ 4 |
| 7 | 🔁 ลูกค้าเก่า (derive จาก customer_id เทียบประวัติ 95 วัน) | B | M | ติดป้าย "อิง 95 วัน" |
| 8 | กำไรประมาณการ (margin% ตั้งได้ใน sync_state) | B | M | pattern เดียวกับ Admin Perf scoring — ติดป้าย "ประมาณการ" |
| 9 | [LEGACY] preset 1 ชม./สัปดาห์นี้ | B | S | ไตรมาส/ปี ติด retention 95 วัน — ติดป้ายถ้าทำ |
| 10 | [LEGACY] เส้น %ปิดตามช่วงเวลา / dual-bar FB vs LINE / รายการออเดอร์ล่าสุด / tFrom–tTo | A/B | M each | **ถาม boss ก่อน** — prototype active เองตัดทิ้งแล้ว |
| — | ROAS ทุกจุด / กำไรหักค่าแอด / alert ROAS-Broadcast / แชทไม่ทำออเดอร์ | C | — | ดูข้อ 3 |

### 1.3 Content & Ads — `lib/views/contentads.ts`, `lib/api/contentads.ts` (⚠️ ตาราง ads ว่างจาก upstream — ทำโค้ดรอได้ แต่เทสต์กับข้อมูลจริงไม่ได้จนกว่า Pancake แก้)

| # | Gap | Tag | Effort | หมายเหตุ |
|---|-----|-----|--------|----------|
| 1 | Fix dropdown สถานะ: เพิ่ม option Organic (หรือ merge key organic→active) + เรียง option ตาม prototype | A | S | **bug จริงตอนนี้** — เลือก Active แล้วแถว Organic หาย |
| 2 | เพิ่ม select `adset_id`, `created_time/start_time` → คอลัมน์ Ad Set ใน CSV + ปัญหา "คอนเทนต์ล้า >30 วัน" ใน modal | A | S | |
| 3 | คอลัมน์ "แอดมินที่ปิดขาย" (orders.seller_name ต่อ ad_id) | A | S | อยู่ใน orders-select ร่วม |
| 4 | ปุ่ม Excel (.xls) | A | S | ใช้ downloadXLS helper กลาง |
| 5 | เปลี่ยน label rank เป็น "🔥 แพงแล้วควรปรับด่วน" | A | S | หรือคงของเรา — ถาม boss |
| 6 | 📤 ส่งต่อทีมคอนเทนต์ (toast จำลอง = เท่า prototype) | B | S | ส่งจริงผ่าน LINE Notify = งานอนาคต |
| 7 | detail-grid 8 บล็อกครีเอทีฟ + 💡 ไอเดีย 3 แบบ (port pool ข้อความ static เลือกตาม metric จริง) | B | M | ตัดเงื่อนไข negComments/repeatQ; อัปเกรด AI จริงภายหลังได้ |
| 8 | 📋 Action Plan store (sync_state KV, max 100) + ปุ่มบน alert + ใน modal + ปุ่ม 2 ปุ่มใน modal-actions | B | M | ทำทีเดียวจบ 3 gap UI |
| 9 | Dropdown "ทุกเพจ" (map ad_id→page_id จาก orders) | B | M | |
| 10 | Dropdown สินค้า (derive จาก items_json ของออเดอร์ที่ผูกแอด) | B | M | ใช้ชื่อสินค้าจริงแทน Product Code |
| 11 | แถว Organic จาก orders.post_id (revenue/orders จริง, ช่อง spend/คลิก = "-") | B | M | |
| 12 | rangeControls จริง (ads_daily snapshot table + delta) | B | L | **ทำหลัง ads กลับมามีข้อมูลเท่านั้น** — ออกแบบ schema รอไว้ได้ |
| — | คอมเมนต์/คอมเมนต์ลบ, rank 😠, คำถามซ้ำ, ⚔️ คู่แข่ง, ประเภทคอนเทนต์/Hook | C | — | ดูข้อ 3 |

### 1.4 Admin Management — `lib/views/admins.ts` (อัปเกรดแล้ววันนี้ — เก็บตกอย่างเดียว)

| # | Gap | Tag | Effort | หมายเหตุ |
|---|-----|-----|--------|----------|
| 1 | Summary: "แชทค้างรวม" (Σ activeByName) | A | S | ค่าคำนวณแล้วใน api |
| 2 | Stats modal: "Online ล่าสุด" จาก marks | A | S | |
| 3 | Filter กลุ่มสินค้า (distinct จาก admin_settings.product_groups) — เพิ่มควบคู่ filter แผนก | B | S | |
| 4 | Product Group เป็น chip multi-select ใน modal ตั้งค่า | B | S | เก็บ field เดิม |
| 5 | "ออนไลน์ล่าสุด HH:MM" บนการ์ด (จาก online_log/orderMark) | B | S | ซื่อสัตย์กว่า "Active X ที่แล้ว" |
| 6 | Dropdown "พักรับแชทใหม่" ใน modal (เขียน status_override ตัวเดิม) | B | S | ไม่เพิ่ม field ใหม่ |
| 7 | เร็วสุด/ช้าสุด = min/max avg_response_ms รายเพจ | B | S | ติดป้าย "เพจที่ตอบเร็ว/ช้าสุด" |
| 8 | max_pending: migration คอลัมน์ + ช่อง modal + waiting/maxPending บนการ์ด | B | M | |
| 9 | เกิน SLA (proxy): waiting + updated_at เก่ากว่า threshold ใน sync_state | B | M | **SLA threshold ตัวเดียวกันใช้ที่หน้า Admin Perf ด้วย — ทำครั้งเดียว** |
| 10 | ⭐ Performance score ใน stats modal header + CSV (reuse Overall scoring) | B | M | **แตก logic scoring เป็น module กลางก่อน — ใช้ 2 หน้า** |
| 11 | ปุ่ม ＋ เพิ่มแอดมิน | B | — | **เสนอตั้งใจไม่ทำ** (roster sync-only, แอดมิน manual ไม่มีสถิติ) |
| 12 | บังคับสถานะ online/offline ตรงๆ | B | — | **เสนอคง deviation** — is_online เป็นข้อมูลจริง ไม่ควรปลอมได้ |
| 13 | Audit log | B | M | ไม่มีหน้าแสดงผลใน scope — เลื่อนไป phase หลัง |
| — | First Resp แยก, เคสเสี่ยง, ใหม่/เก่าต่อคน, โอนแชท, รายชั่วโมงต่อคน, timeline ละเอียด | C | — | ดูข้อ 3 |

### 1.5 Admin Performance — `lib/views/adminperf.ts`, `lib/api/adminperf.ts`

| # | Gap | Tag | Effort | หมายเหตุ |
|---|-----|-----|--------|----------|
| 1 | KPI strip: ทั้งหมด/ออนไลน์/ออฟไลน์/ปิดใช้งาน (reuse effectiveStatus จากหน้า Admins) | A | S | |
| 2 | KPI: แชทใหม่วันนี้ (Σ chats จาก rows) | A | S | |
| 3 | KPI: Response เฉลี่ยทีม + ตอบเร็วสุด (กรอง replies > threshold) | A | S | client-side จาก rows เดิม |
| 4 | KPI: ลูกค้าใหม่ (Σ chat_hourly.new_customer_count) | A | S | |
| 5 | การ์ด hbar "เปรียบเทียบข้อความที่ตอบ" top 10 (hbarRows มีแล้ว) | A | S | |
| 6 | กราฟปริมาณงานรายชั่วโมงทีมรวม จาก chat_hourly.hour + bindChartTips | A | M | ของเราจะเป็นข้อมูลจริง (prototype สุ่ม mock) |
| 7 | จัด layout: pg-summary (เฉพาะ KPI ที่ทำจริงได้) → dash-row (hbar+รายชั่วโมง) → podium → rank list | B | M | คง podium+แผงเกณฑ์ไว้ |
| 8 | KPI: แชทค้างมากสุด (reuse activeByName จาก admins.ts) — โชว์เฉพาะ preset วันนี้ + label "ตอนนี้" | B | M | |
| 9 | Role filter + badge (admin_settings.role) | B | M | **ถาม boss ก่อน** — README Phase 15 บอกหน้านี้ไม่มี Role |
| 10 | Product group filter (logic เดียวกับหน้า Admins ข้อ 3) | B | M | ทำพร้อมกันกับหน้า Admins |
| 11 | SLA proxy ต่อคน (นิยามเองจาก threshold ใน sync_state) | B | M | ผูกกับ Admins ข้อ 9 — สื่อสารว่าไม่ใช่ per-case SLA |
| 12 | มุมมองตารางกะทัดรัด (toggle การ์ด/ตาราง) | B | M | optional — การ์ดเราแน่นกว่า |
| — | ASSIGN_QUEUE (แจก/รอ/โอน/ไม่มีคนรับ), ROAS mode, ลูกค้าเก่าต่อคน, First vs Reply | C | — | ดูข้อ 3 |

---

## 2) ลำดับการลงมือข้ามหน้า (จัดกลุ่ม infra ไม่ให้สร้างซ้ำ)

### 🏗️ Infra ที่ใช้ร่วมหลายหน้า — สร้างครั้งเดียวก่อนใช้
| Infra | ใช้ที่ | สร้างที่ |
|---|---|---|
| `downloadXLS()` (HTML-table .xls) | Sales, Content&Ads | lib/ui/helpers.ts |
| ขยาย orders select: page_id + account_name (map ผ่าน pages) + items_json + seller_name | Sales drilldown/hbar, Content&Ads คอลัมน์แอดมิน/เพจ/สินค้า/Organic | lib/api/sales.ts + contentads.ts (query layer) |
| `bindChartTips` คลุมกราฟแท่ง (ต่อจาก svgHourlyLine) | Dashboard week bars, AdminPerf hourly | lib/ui/charts.ts |
| `tagColor(name)` hash→palette | Dashboard tag cloud (อนาคต: ทุกที่ที่มีแท็ก) | lib/ui/helpers.ts |
| KV settings ใน sync_state (pattern มีแล้วจาก scoreconfig): `margin_pct`, `sla_threshold_mins`, `action_plans[]` | Sales กำไร, Admins+AdminPerf SLA, Content&Ads Action Plan | lib/api (settings endpoints) |
| แตก Overall scoring เป็น module กลาง | AdminPerf (เดิม) + Admins stats modal/CSV | lib/ (client-side) |
| reuse `effectiveStatus` / `activeByName` / `waitingByName` | AdminPerf KPI strip | export จาก lib/api/admins.ts |

### 📅 ลำดับแนะนำ

**Sprint 1 — Quick wins ล้วน [A/B + S] (~2–3 วัน, เห็นผลทันทีทุกหน้า)**
1. Content&Ads: fix dropdown Organic (bug จริง) + adset/created_time select + คอลัมน์แอดมินปิดขาย + คอนเทนต์ล้า
2. Sales: ปุ่ม ⟳ + compare prev7/prev30
3. `downloadXLS` helper → ปุ่ม Excel ทั้ง Sales + Content&Ads
4. Dashboard: การ์ดตอบอัตโนมัติ + ชิป Comment + badge ด่วน + string/สี + tagColor + polling
5. Admins: แชทค้างรวม + Online ล่าสุด + "ออนไลน์ล่าสุด HH:MM" + dropdown พักรับแชท + เร็วสุด/ช้าสุดรายเพจ
6. AdminPerf: KPI strip พื้นฐาน (4 สถานะ + แชทใหม่ + Response เฉลี่ย/เร็วสุด + ลูกค้าใหม่) + การ์ด hbar ตอบ top10
7. เช็ค 2 อย่างใน Supabase/Pancake: ค่า distinct platform (ชิป Messenger) + รูปแบบ deep-link URL Pancake → ถ้าผ่าน ทำต่อเลย (S ทั้งคู่)

**Sprint 2 — Infra กลาง + งาน M หลัก (~4–6 วัน)**
1. ขยาย orders select ครั้งเดียว → Sales drilldown modal (Top5 เพจ/สินค้า) → hbar สินค้า/เพจบนหน้า → Content&Ads dropdown เพจ/สินค้า + แถว Organic
2. KV settings ชุดเดียว: margin% (Sales กำไรประมาณการ) + SLA threshold (Admins ข้อ 9 + AdminPerf ข้อ 11 พร้อมกัน)
3. แตก scoring module → ⭐ ใน Admins stats modal + CSV
4. Admins: migration max_pending + chip multi-select product groups + filter กลุ่มสินค้า (ทำ filter เดียวกันที่ AdminPerf ด้วย)
5. AdminPerf: กราฟรายชั่วโมงทีมรวม + จัด layout pg-summary/dash-row + แชทค้างมากสุด
6. bindChartTips คลุมกราฟแท่ง (Dashboard + AdminPerf ทีเดียว)
7. Dashboard: การ์ดคอมเมนต์แยกตามเพจ
8. Sales: ลูกค้าเก่า derive 95 วัน

**Sprint 3 — งานที่ต้องตัดสินใจ / optional (~3–4 วัน ถ้าเอาหมด)**
- Content&Ads: creative blocks 8 บล็อก + Action Plan store + ปุ่มส่งต่อ/บันทึกใน modal (ชุดเดียวกัน)
- ❓ **คำถามถึง boss ก่อนทำ**: (a) แท่งซ้อนทับ vs แท่งคู่ Dashboard, (b) ฟีเจอร์ LEGACY Sales (tFrom–tTo, dual-bar, เส้น %ปิด, รายการออเดอร์) — prototype เองตัดทิ้งแล้ว, (c) Role filter หน้า AdminPerf (README บอกไม่มี), (d) ปุ่มเพิ่มแอดมิน (เสนอไม่ทำ), (e) label rank Content&Ads
- AdminPerf: toggle มุมมองตาราง (ถ้า boss อยากได้)
- Audit log (ไม่มีหน้าแสดง — ความสำคัญต่ำสุด)

**Track คู่ขนาน — รอ upstream ads**: ออกแบบ schema `ads_daily` ไว้ (ยังไม่ต้อง implement) — ทันทีที่ Pancake ads กลับมา: ROAS ทุกจุด (Sales/Content&Ads/AdminPerf) + rangeControls Content&Ads จะปลดล็อกเป็น [A] ทันทีเพราะโค้ดอ่าน ads อยู่แล้ว

---

## 3) ทำไม่ได้ตอนนี้ [C] — เหตุผล + phase ที่จะปลดล็อก

| Gap | หน้า | ทำไมไม่ได้ | ปลดล็อกด้วย |
|---|---|---|---|
| ROAS ทุกจุด, กำไรหักค่าแอด, alert ROAS ต่ำ, rank ROAS | Sales, Content&Ads, AdminPerf | ตาราง ads ว่าง — Pancake ads endpoint คืนค่าว่าง (upstream) | **Pancake แก้ ads endpoint** → กลายเป็น [A] ทันที (โค้ดอ่าน ads อยู่แล้ว) |
| rangeControls จริงของ Content&Ads | Content&Ads | spend/คลิกเป็น snapshot สะสม ไม่มีมิติเวลา | ads กลับมา + ตาราง ads_daily เก็บ delta รายวัน (มีข้อมูลเฉพาะหลังเริ่มเก็บ) |
| คอมเมนต์/คอมเมนต์ลบ ต่อคอนเทนต์, rank 😠, alert คอมเมนต์ลบ | Content&Ads, Dashboard | ไม่มีข้อมูลคอมเมนต์ระดับโพสต์/แอด + ไม่มี sentiment | **Comments phase** (นอก scope ปัจจุบัน) |
| Intent, คำถามซ้ำ, เคสเสี่ยง/ร้องเรียน, urgency จาก AI | Dashboard, Content&Ads, Admins | ต้องวิเคราะห์เนื้อหาข้อความ — เรามีแค่ snippet 24 ชม. ไม่มีข้อความเต็ม | **Inbox/webhook + AI analysis phase** |
| Section Products & KB ทั้งชุด, การ์ด KB, Product Code | Dashboard, Content&Ads | ไม่มีตาราง products/KB/groupCode | **Products phase** (นอก scope) |
| ลูกค้าใหม่/เก่า ต่อแอดมิน | Admins, AdminPerf | admin_chat_daily ไม่แยก new/returning ต่อคน — Pancake ไม่ให้ | ต้องรอ Pancake เพิ่ม field หรือ webhook per-message |
| First Response แยกจาก Reply, เร็วสุด/ช้าสุด per-message, SLA per-case | Admins, AdminPerf | Pancake ให้แค่ avg_response_ms รายวัน | webhook/event stream phase (ระหว่างนี้ใช้ SLA proxy [B]) |
| โอนออก/รับโอน, ASSIGN_QUEUE (แจก/รอ/โอนอัตโนมัติ), timeline เหตุการณ์ละเอียด | Admins, AdminPerf | ไม่มี event การโอน/assign ใน synced data + เราไม่มีระบบ routing | **Routing phase** (นอก scope) |
| ชิป Reels / Ads Inbox, ปักหมุด | Dashboard | conversations ที่ sync ไม่มี field source Reels / ad_ids / pinned | ปรับ sync ให้เก็บ field เพิ่ม (ถ้า Pancake API มีให้) |
| ⚔️ คู่แข่งทำแนวเดียวกัน | Content&Ads | mock สุ่มล้วน — ของจริงต้อง crawl Ad Library | โปรเจกต์แยก (มี MCP Meta Ads `ads_library_search` เป็นทางเลือกอนาคต) |
| ประเภทคอนเทนต์/Hook text | Content&Ads | Pancake ไม่ให้ creative — ต้องต่อ Meta Marketing API | Meta creative sync phase |
| แชทยังไม่ทำออเดอร์ | Sales | ไม่มี linkage conversation↔order ที่เชื่อถือได้ | webhook phase + customer id mapping |
| real-time แท้ | Dashboard | sync ทุก 15 นาที | webhook phase (ระหว่างนี้ polling [B] ให้ความรู้สึกใกล้เคียง) |

---

## 4) ประมาณการรวม

| ก้อนงาน | ปริมาณ | เวลาโดยประมาณ |
|---|---|---|
| Sprint 1 quick wins (~22 รายการ S) | S ล้วน | **2–3 วันทำงาน** |
| Sprint 2 infra + M หลัก (~12 รายการ) | M เป็นหลัก | **4–6 วันทำงาน** |
| Sprint 3 optional + รอคำตอบ boss (~8 รายการ) | S/M | **3–4 วันทำงาน** (ตัดได้ตามคำตอบ) |
| Track รอ ads (ROAS + ads_daily) | blocked | ~2–3 วัน **หลัง upstream แก้** |
| **รวม core parity (Sprint 1+2)** | | **~6–9 วันทำงาน** |
| **รวมทั้งหมดถ้าเอาครบทุก optional** | | **~10–13 วันทำงาน** |

**นิยาม "เสร็จ" ที่แนะนำ**: จบ Sprint 1+2 = ทุกหน้าครบฟีเจอร์ prototype ที่มีข้อมูลจริงรองรับ, รายการ [C] สื่อสารกับ boss ตามตารางข้อ 3 ว่ารออะไร — ไม่ควรปลอมข้อมูลเพื่อให้ "เหมือน" mock

**เช็คก่อนเริ่ม Sprint 1** (5 นาที): distinct `platform` ใน conversations/chat_hourly, รูปแบบ URL แชท Pancake web, และยิงคำถาม 5 ข้อถึง boss (Sprint 3) ไว้ล่วงหน้าเพื่อไม่ block ลำดับงาน