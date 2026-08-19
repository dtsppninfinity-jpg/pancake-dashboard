// scripts/setup/seed-nicknames.ts — ตั้งชื่อเล่นแอดมิน + ปิดคนที่ลาออก จากไฟล์ส่งออกของชีททีม
//
// ปกติงานนี้ทำเองอัตโนมัติทุกชั่วโมง (jobs.syncRosterSheet อ่านชีท "ยันยอดแอดมิน" แท็บ Data)
// สคริปต์นี้ไว้ใช้ตอนที่ยัง **แชร์ชีทให้บัญชีระบบไม่ได้** — ส่งออกแท็บ Data เป็นไฟล์แล้วยัดเข้าแทน
// ตรรกะจับคู่/เขียนใช้ตัวเดียวกับงาน sync (applyRosterRows) จะได้ไม่มีทางให้ผลต่างกัน
//
// ใช้: npx tsx scripts/setup/seed-nicknames.ts <ไฟล์.json>          → ดูว่าจะเปลี่ยนอะไร (ไม่เขียน)
//      npx tsx scripts/setup/seed-nicknames.ts <ไฟล์.json> --apply  → เขียนลง admin_settings
// รูปแบบไฟล์: [{ "fb": "ชื่อใน Pancake", "nick": "ชื่อเล่น", "code": "รหัสพนักงาน", "out": true }]
//   หรือรูปแบบดิบจากชีทเลยก็ได้: [{ "code": "...", "name": "ฟ้า วิลัยเลิศ (ฟ้า) ออก", "fb": "..." }]
import '../../lib/env';
import { applyRosterRows } from '../sync/jobs';
import { parseRosterData, stripFbNote, type RosterRow } from '../../lib/rostersheet';
import { readFileSync } from 'fs';

/** แถวในไฟล์ → RosterRow — ยอมรับทั้งแบบแตกช่องมาแล้ว และแบบยกเซลล์ชีทมาทั้งดุ้น */
function toRows(list: any[]): RosterRow[] {
  const needParse = list.some((r) => !r.nick);
  if (needParse) {
    // ปั้นกลับเป็นตารางแล้วส่งให้ตัวแกะชีทตัวเดียวกัน — กติกา "(ชื่อเล่น)" / "ออก" จะได้เหมือนกันเป๊ะ
    return parseRosterData(list.map((r) => [String(r.code ?? ''), String(r.name ?? ''), String(r.fb ?? ''), '']));
  }
  return list.map((r) => {
    const fbRaw = String(r.fbRaw ?? r.fb ?? '').trim();
    return {
      code: String(r.code ?? ''), realName: String(r.real ?? r.realName ?? ''),
      nick: String(r.nick), fb: stripFbNote(r.fb ?? fbRaw), fbRaw,
      left: r.out === true || r.left === true,
    };
  });
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('ใช้: npx tsx scripts/setup/seed-nicknames.ts <ไฟล์.json> [--apply]'); process.exit(1); }
  const apply = process.argv.indexOf('--apply') >= 0;
  const rows = toRows(JSON.parse(readFileSync(file, 'utf8')));
  if (!rows.length) { console.error('❌ ไฟล์ไม่มีแถวที่ใช้ได้'); process.exit(1); }

  const res = await applyRosterRows(rows, !apply);
  console.log(`ไฟล์ ${rows.length} แถว | จับคู่ไม่ได้ ${res.unmatched.length} | จะเปลี่ยน ${res.changes.length} แถว`);
  res.changes.forEach((c) => console.log(
    `  ${c.off ? '⛔' : '✏️'} ${c.fb.padEnd(28)} ${c.from} → ${c.to}  (${c.why})`));
  if (res.unmatched.length) {
    console.log('--- ชื่อเฟสนี้ไม่มีในระบบ (Pancake เปลี่ยนชื่อ / พิมพ์ผิดในชีท) ---');
    res.unmatched.forEach((m) => console.log(`  ✗ ${String(m.fbRaw).padEnd(28)} (${m.nick})`));
  }
  console.log(apply ? `\n■ บันทึกแล้ว ${res.written} แถว` : '\n(ยังไม่เขียนอะไร — ใส่ --apply ถ้าถูกต้องแล้ว)');
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
