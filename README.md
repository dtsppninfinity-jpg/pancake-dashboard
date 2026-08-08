# PN Infinity — Pancake Dashboard (เวอร์ชัน Full-stack)

เวอร์ชันใหม่ที่ย้ายจาก Google Apps Script + Google Sheet มาเป็น **Supabase (Postgres) +
GitHub Actions (cron) + Next.js (Vercel)** — เร็วกว่า เสถียรกว่า และยังฟรี

```
GitHub Actions (cron ทุก 15 นาที)
      │ รัน Node script
      ▼
Sync Worker (TypeScript)  ──fetch──▶  Pancake POS + Pages API
      │ เขียน
      ▼
Supabase Postgres (มี index → เร็ว)
      ▲ อ่าน
      │
Next.js Dashboard บน Vercel
```

## โครงสร้างโปรเจกต์

```
pancake-dashboard/
├── db/schema.sql          โครงตาราง Postgres (รันใน Supabase ครั้งเดียว)
├── lib/
│   ├── config.ts          ค่าคงที่ + helper วันที่ (โซนไทย)
│   ├── pancake.ts         HTTP client เรียก Pancake API
│   ├── mappers.ts         แปลงข้อมูลดิบ → แถวตาราง
│   └── supabase.ts        client เขียน DB + upsert/log/state helper
├── scripts/               (เฟส 2) sync worker + setup scripts
├── app/                   (เฟส 3) Next.js dashboard
└── .github/workflows/     (เฟส 2) cron
```

## สถานะการสร้าง

- [x] **เฟส 1 — รากฐาน**: schema, config, Pancake client, mappers, Supabase client
- [ ] เฟส 2 — Sync worker + GitHub Actions cron
- [ ] เฟส 3 — Next.js dashboard 5 หน้า
- [ ] เฟส 4 — Deploy (Vercel) + ย้ายข้อมูลจากชีตเดิม

## 🩺 ระบบเฝ้าระวังข้อมูล (อย่ารื้อโดยไม่อ่าน)

ปัญหาที่แพงที่สุดของระบบนี้ไม่ใช่ "งาน sync ล้ม" แต่คือ **งาน sync บอกว่าสำเร็จทั้งที่ทำงานไม่ครบ**
(ส.ค. 2026 เจอติดกัน 4 เคส ทุกเคสขึ้นเขียวหมด กว่าทีมจะจับได้ก็ผ่านไปเป็นสัปดาห์) จึงมี 3 ชั้นนี้:

| ชั้น | ไฟล์ | ทำอะไร |
|---|---|---|
| ตรวจกุญแจก่อนเริ่มรอบ | `scripts/sync/envcheck.ts` | ขาดค่าจำเป็น = หยุดทั้งรอบ + เขียน log, ขาดค่าฟีเจอร์ = ฟ้องแต่ไปต่อ — ห้ามให้งาน "ข้าม" ตัวเองเงียบๆ |
| ใบรายงานผลของแต่ละงาน | `lib/jobstat.ts` | งานคืน **ตัวเลข** (`unitsOk/unitsFailed/rowsWritten/skipped/scope`) ไม่ใช่ข้อความไทยล้วน แล้วเก็บลง `sync_state` คีย์ `job_stat:<งาน>` |
| ตรวจว่าเลขที่ได้เป็นไปได้ไหม | `scripts/sync/invariants.ts` | รันปิดท้ายรอบ hourly/daily — ผิดข้อไหนเขียนเป็นงาน `invariants` ล้มลง `sync_log` |

กฎที่ตรวจอยู่ (ทุกข้อคิดจาก "เมื่อวาน" เพราะวันนี้ยังเดินอยู่): มีออเดอร์ • สถิติแชทครอบคลุมเพจที่มีออเดอร์ ≥70% •
%ปิดการขาย ≤100% • มีค่าแอดแล้วต้องมีคนทัก • %ปิดจากแอด ≤150% • กำไรจากชีทไม่ค้างเกิน 2 วัน •
ไม่มีแถว "วันอนาคต" • ทุกงานไม่พลาดเพจเกิน 1 ใน 3 และแถวไม่หายเกินครึ่งจากรอบก่อน

ทีมเห็นผลที่ **ชิปบนหัวเว็บ** (`⚠️ งาน sync มีปัญหา N งาน` — ชี้เมาส์ดูรายละเอียด) และในแถบข้างซ้าย
โค้ดฝั่งอ่านอยู่ที่ `lib/api/bootstrap.ts` (`syncHealth`)

> เพิ่มงาน sync ใหม่: คืน `jobResult(ข้อความ, { unitsTotal, unitsFailed, rowsWritten, scope })` แทน `return 'ข้อความ'`
> ถ้าทำงานไม่ได้เพราะขาดของ ให้ใส่ `skipped` (จะถูกนับเป็นไม่สำเร็จ) — อย่า `return 'ข้าม: ...'` เฉยๆ

## เริ่มใช้งาน (สิ่งที่ต้องทำ)

### 1. ติดตั้ง dependencies
```bash
npm install
```

### 2. สร้างโปรเจกต์ Supabase (ฟรี)
1. สมัคร/เข้า https://supabase.com → **New project** (เลือก region ใกล้ไทย เช่น Singapore)
2. รอสร้างเสร็จ → เมนู **SQL Editor** → **New query** → เปิดไฟล์ [db/schema.sql](db/schema.sql) วางทั้งหมด → **Run**
3. เมนู **Project Settings → API** → copy 2 ค่า:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret → `SUPABASE_SERVICE_ROLE_KEY`

### 3. ตั้งค่า environment
```bash
cp .env.example .env.local
```
แล้วกรอกค่าใน `.env.local` (Pancake keys ชุดเดิม + Supabase 2 ค่าจากข้อ 2)

### 4. (เฟส 2) รัน sync
```bash
npm run setup:pages   # ค้นหาเพจ + สร้าง token → เก็บใน DB
npm run backfill      # ดึงข้อมูลย้อนหลังครั้งแรก
npm run sync:fast     # ทดสอบ sync รอบสั้น
```

> คีย์ทั้งหมดอยู่ใน `.env.local` (ไม่ขึ้น git) และ GitHub Secrets — ไม่รั่วในโค้ด
