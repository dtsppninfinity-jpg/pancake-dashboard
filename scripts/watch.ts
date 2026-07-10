// scripts/watch.ts — จอแสดงความคืบหน้าแบบ live (รีเฟรชเอง) ระหว่าง backfill/sync
// อ่าน "ขั้นที่กำลังทำ" จาก sync_state ('backfill') + จำนวนแถวจริงในแต่ละตาราง
// ใช้: npm run watch   (กด Ctrl+C เพื่อออก)
import '../lib/env';
import { supabase } from '../lib/supabase';

const TABLES = [
  { key: 'orders', label: 'ออเดอร์' },
  { key: 'chat_hourly', label: 'สถิติแชท 7 วัน' },
  { key: 'conversations', label: 'บทสนทนา' },
  { key: 'admins', label: 'รายชื่อแอดมิน' },
  { key: 'ads', label: 'แอด' },
  { key: 'admin_chat_daily', label: 'สถิติแอดมิน' },
];
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

async function getCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(TABLES.map(async (t) => {
    const { count } = await supabase.from(t.key).select('*', { count: 'exact', head: true });
    out[t.key] = count || 0;
  }));
  return out;
}

async function getProgress(): Promise<any | null> {
  const { data } = await supabase.from('sync_state').select('value').eq('key', 'backfill').maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : null; } catch { return null; }
}

function bar(pct: number, width = 26): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function main() {
  const start = Date.now();
  let prev: Record<string, number> = {};
  let frame = 0;
  for (;;) {
    const c = await getCounts();
    const prog = await getProgress();
    const spin = SPIN[frame % SPIN.length];
    const el = Math.floor((Date.now() - start) / 1000);
    const clock = `${String(Math.floor(el / 60)).padStart(2, '0')}:${String(el % 60).padStart(2, '0')}`;

    console.clear();
    console.log('');
    console.log(`   🥞  PN Infinity — Backfill ข้อมูลย้อนหลัง    ${spin}   ⏱  ${clock}`);
    console.log('');
    if (prog?.done) {
      console.log('   ✅  backfill เสร็จครบทุกขั้นแล้ว! 🎉');
    } else if (prog && prog.current > 0) {
      const pct = Math.round((prog.current / prog.total) * 100);
      console.log(`   🔄  กำลังทำ:  ขั้น ${prog.current}/${prog.total} — ${prog.label || ''}`);
      console.log(`   [${bar(pct)}]  ${pct}%`);
    } else {
      console.log('   ⏳  กำลังเริ่ม...');
    }
    console.log('');
    console.log('   📦  จำนวนแถวในฐานข้อมูลตอนนี้:');
    for (const t of TABLES) {
      const val = c[t.key];
      const delta = val - (prev[t.key] ?? 0);
      const deltaStr = delta > 0 ? `   ▲ +${delta.toLocaleString()}` : '';
      console.log(`       ${t.label.padEnd(18)} ${String(val.toLocaleString()).padStart(10)}${deltaStr}`);
    }
    console.log('');
    if (prog?.done) { process.exit(0); }
    console.log('   ℹ️  บาง step (แชท/บทสนทนา/แอดมิน) จะขึ้นทีเดียวตอนทำเสร็จ · กด Ctrl+C ออก');
    prev = c;
    frame++;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
