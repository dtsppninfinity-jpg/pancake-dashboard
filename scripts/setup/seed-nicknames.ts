// scripts/setup/seed-nicknames.ts — ใส่ "ชื่อเล่นจริง" ของแอดมินจากชีททีม
//
// ที่มา: ไฟล์ "ยันยอดแอดมิน" แท็บ **Data** — คอลัมน์ `ชื่อแอดมิน` เก็บชื่อจริงพร้อมชื่อเล่นในวงเล็บ
// ("โสภา นำพา (น้ำ)") ส่วนคอลัมน์ `Facebook` คือชื่อที่ Pancake ใช้ ซึ่งตรงกับ `admins.name` ของเรา
//
// ทำไมต้อง seed: ระบบเดาชื่อเล่นจากคำแรกของชื่อ Pancake อยู่แล้ว ("หมีน้อย สีน้ำตาล" → "หมีน้อย")
// แต่ชื่อ Pancake หลายคนเป็นนามแฝงคนละเรื่องกับตัวจริง ("Gary C. Madsen" = ก้า) เดายังไงก็ไม่ถูก
//
// ใช้: npx tsx scripts/setup/seed-nicknames.ts <ไฟล์.json>          → ดูข้อเสนอเฉยๆ
//      npx tsx scripts/setup/seed-nicknames.ts <ไฟล์.json> --apply  → เขียนลง admin_settings
// รูปแบบไฟล์: [{ "fb": "ชื่อใน Pancake", "real": "ชื่อจริง", "nick": "ชื่อเล่น", "code": "รหัสพนักงาน" }]
import '../../lib/env';
import { supabase } from '../../lib/supabase';
import { readFileSync } from 'fs';

type Row = { fb: string; real?: string; nick: string; code?: string };

/** ตัดช่องว่างซ้ำ/ช่องว่างหัวท้าย + ตัวพิมพ์เล็ก — ชื่อในชีทมีเว้นวรรคเกินบ่อย */
function norm(s: unknown): string {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('ใช้: npx tsx scripts/setup/seed-nicknames.ts <ไฟล์.json> [--apply]'); process.exit(1); }
  const apply = process.argv.indexOf('--apply') >= 0;
  const list: Row[] = JSON.parse(readFileSync(file, 'utf8'));

  const { data: admins, error } = await supabase.from('admins').select('user_id,name');
  if (error) throw new Error('อ่าน admins ไม่สำเร็จ: ' + error.message);
  const byName: Record<string, { user_id: string; name: string }> = {};
  (admins || []).forEach((a: any) => { byName[norm(a.name)] = { user_id: String(a.user_id), name: String(a.name || '') }; });

  const hit: Array<{ user_id: string; name: string; nick: string }> = [];
  const miss: Row[] = [];
  for (const r of list) {
    const a = byName[norm(r.fb)];
    if (!a || !r.nick) { miss.push(r); continue; }
    hit.push({ user_id: a.user_id, name: a.name, nick: r.nick });
  }

  console.log(`ชีท ${list.length} คน | แอดมินในระบบ ${(admins || []).length} คน | จับคู่ได้ ${hit.length} | ไม่เจอ ${miss.length}`);
  hit.forEach((h) => console.log(`  ✓ ${h.name.padEnd(28)} → ${h.nick}`));
  if (miss.length) {
    console.log('--- ไม่เจอชื่อนี้ในระบบ (ลาออกแล้ว/ชื่อ Pancake เปลี่ยน) ---');
    miss.forEach((m) => console.log(`  ✗ ${String(m.fb).padEnd(28)} (${m.nick || 'ไม่มีชื่อเล่น'})`));
  }
  if (!apply) { console.log('\n(ยังไม่เขียนอะไร — ใส่ --apply ถ้าถูกต้องแล้ว)'); return; }

  // admin_settings อาจยังไม่มีแถวของคนนั้น → upsert สร้างให้ (ไม่แตะคอลัมน์อื่น)
  const rows = hit.map((h) => ({ user_id: h.user_id, nickname: h.nick, updated_at: new Date().toISOString() }));
  const { error: upErr } = await supabase.from('admin_settings').upsert(rows, { onConflict: 'user_id' });
  if (upErr) throw new Error('บันทึกไม่สำเร็จ: ' + upErr.message);
  console.log(`\n■ บันทึกชื่อเล่นแล้ว ${rows.length} คน`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
