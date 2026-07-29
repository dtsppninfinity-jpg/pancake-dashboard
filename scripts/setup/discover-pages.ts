// scripts/setup/discover-pages.ts — ค้นหาเพจ + สร้าง page_access_token → เก็บใน DB
// ตอนนี้เป็นแค่ทางลัดให้รันมือได้ทันที — ตัวงานจริงคือ jobs.syncPages ซึ่งรันเองทุกวันแล้ว
// (เดิมโค้ดอยู่ที่นี่ที่เดียวและ "รันครั้งเดียวตอน setup" ทำให้เพจที่เปิดใหม่ไม่เคยเข้าระบบ)
import '../../lib/env';
import { syncPages } from '../sync/jobs';

async function main() {
  console.log('✅ ' + await syncPages());
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
