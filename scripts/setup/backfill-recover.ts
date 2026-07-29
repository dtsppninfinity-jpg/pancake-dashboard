// scripts/setup/backfill-recover.ts — กู้ข้อมูลย้อนหลังที่ยังดึงคืนได้จากต้นทาง
//
// ทำไมต้องมีแยกจาก backfill.ts: ตัวนั้นตั้งไว้ 30 วัน/7 วัน สำหรับติดตั้งครั้งแรก
// ตัวนี้ไล่กู้ "รู" ที่เกิดจาก retention เดิม 95 วัน + ช่วงที่ sync พลาด
// รันได้ซ้ำ (ทุก job เป็น upsert by key) — ช้าแต่ปลอดภัย
//
// ใช้: npx tsx scripts/setup/backfill-recover.ts [days] [--only=orders|chat|admin]
//      (default 100 วัน, ทำครบทั้ง 3 ขั้น) — --only ไว้รันซ้ำเฉพาะขั้นที่ล้มเหลว
import '../../lib/env';
import { requireCredentials, daysAgo } from '../../lib/config';
import * as jobs from '../sync/jobs';

async function step(label: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  process.stdout.write(`⏳ ${label} ... `);
  try {
    const msg = await fn();
    console.log(`${msg}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } catch (e: any) {
    console.log(`❌ ${e.message}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}

async function main() {
  requireCredentials();
  const args = process.argv.slice(2);
  const days = Math.max(1, Math.round(Number(args.find((a) => /^\d+$/.test(a))) || 100));
  const onlyArg = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
  const want = (s: string) => !onlyArg || onlyArg === s;
  console.log(`🚑 กู้ข้อมูลย้อนหลัง ${days} วัน${onlyArg ? ` (เฉพาะ ${onlyArg})` : ''}` +
    ` — ต้นทางมีข้อมูลตั้งแต่ ~30 เม.ย. 2026 เท่านั้น\n`);

  // ออเดอร์ก่อน — เป็นตัวที่มีรูจริง (มิ.ย. หายหลายช่วง) และเป็นฐานของทุกยอด
  if (want('orders')) await step(`ออเดอร์ ${days} วัน`, () => jobs.syncOrdersBackfill(days));
  // สถิติแชทรายชั่วโมง — Pancake statistics/pages ย้อนได้ถึง ~มี.ค. 2026
  if (want('chat')) await step(`สถิติแชท ${days} วัน`, () => jobs.syncChatStats(daysAgo(days), new Date()));
  // สถิติรายแอดมิน — ยิงทีละวัน ช้าสุดในชุดนี้
  if (want('admin')) await step(`สถิติแอดมิน ${days} วัน`, () => jobs.syncAdminChatBackfill(days));

  console.log('\n✅ เสร็จ — ค่าแอด Meta ให้รันแยก: npm run backfill:meta-ads -- <days>');
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n❌', e.message); process.exit(1); });
