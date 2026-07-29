// scripts/setup/seed-page-units.ts — จับคู่ "เพจ → ยูนิต (U)" ที่ยังว่างอยู่ ด้วยชื่อเพจ
//
// ทำไมต้องมี: แหล่งจับคู่หลักคือชีท "Data Page" ของทีม (Page ID → Unit) แต่ชีทนั้นมีแต่เพจ Facebook
// — LINE OA ไม่มีเลยสักเพจ และเพจ Facebook ที่เปิดใหม่ก็ยังไม่ถูกใส่ในชีท ยอดของเพจพวกนี้จึงตกกลุ่ม
// "ยังไม่จัดกลุ่ม" ในหน้า Sales (ตรวจ 2026-07-29: 44 เพจ ~฿1.57M ต่อ 90 วัน)
//
// กติกา: แตะเฉพาะเพจที่ "ยังไม่มียูนิต" เท่านั้น — เพจที่จับคู่จากชีทแล้วห้ามย้าย
// (ชีทคือความจริง ชื่อเพจเป็นแค่ตัวเดา) เพจที่กติกาไม่ครอบคลุมจะถูกรายงานให้จับมือใน U Map
//
// ใช้:  npx tsx scripts/setup/seed-page-units.ts          → แสดงข้อเสนอเฉยๆ (ไม่เขียน)
//       npx tsx scripts/setup/seed-page-units.ts --apply  → เขียนลง sync_state.u_map
import '../../lib/env';
import { supabase } from '../../lib/supabase';

/**
 * กติกาชื่อเพจ → U (ตรวจตามลำดับ อันแรกที่เจอชนะ)
 * ⚠️ ลำดับสำคัญมาก: 'gavista' ต้องมาก่อน 'vista' และ 'probiowa' ต้องมาก่อน 'probiova'
 * ไม่งั้นสินค้าคนละตัวจะถูกยัดเข้ายูนิตเดียวกันเงียบๆ
 */
const RULES: Array<{ u: string; keys: string[] }> = [
  { u: 'U14', keys: ['gavista'] },
  { u: 'UN9', keys: ['probiowa'] },
  { u: 'UN8', keys: ['probiova'] },
  { u: 'UN1', keys: ['plukaow', 'พลูคาว'] },
  { u: 'U4', keys: ['hayeon', 'hayeong', 'ha yeon', 'ฮายอง'] },
  // Cocolly มี 2 ยูนิต: กาแฟ (U26) กับตัวหลัก (U25) — ต้องเช็คคำว่ากาแฟก่อน
  { u: 'U26', keys: ['cocolly coffee', 'cocollyกาแฟ', 'cocolly กาแฟ', 'กาแฟดำ', 'กาแฟ - โคคอลลี่', 'โคคอลลี่ กาแฟ'] },
  { u: 'U25', keys: ['cocolly', 'โคคอลลี่'] },
  { u: 'UN4', keys: ['reno'] },
  { u: 'U16', keys: ['biofla'] },
  { u: 'U18', keys: ['merry', 'เมอร์รี่', 'แม่ตั๊ก'] },
  { u: 'U10', keys: ['veggy'] },
  { u: 'UN10', keys: ['vista'] },
  { u: 'UN5', keys: ['presiva', 'magnesium', 'แมกนีเซียม', 'แมกนีเซี่ยม'] },
  { u: 'UN3', keys: ['ดวงดรุณี'] },
  { u: 'U3', keys: ['glacier', 'บัวหิมะ'] },
  { u: 'UN6', keys: ['myco'] },
  { u: 'UN7', keys: ['complete green'] },
  { u: 'U9', keys: ['venorra'] },
  { u: 'U11', keys: ['kome'] },
  { u: 'U12', keys: ['harina'] },
  { u: 'U13', keys: ['mgb'] },
  { u: 'U15', keys: ['so-ar', 'soar'] },
  { u: 'UN11', keys: ['lysva'] },
];

function guessUnit(name: string): string {
  const s = String(name || '').toLowerCase();
  for (const r of RULES) if (r.keys.some((k) => s.includes(k))) return r.u;
  return '';
}

async function main() {
  const apply = process.argv.indexOf('--apply') >= 0;

  const { data: st } = await supabase.from('sync_state').select('value').eq('key', 'u_map').maybeSingle();
  if (!st) throw new Error('ยังไม่มี u_map ใน sync_state — เปิดหน้า U Map บนเว็บหนึ่งครั้งให้ระบบ seed ก่อน');
  const doc = JSON.parse(String(st.value || '{}'));
  const units: any[] = Array.isArray(doc.units) ? doc.units : [];

  const taken = new Set<string>();
  for (const u of units) for (const p of (u.pages || [])) taken.add(String(p.id));

  const { data: pages } = await supabase.from('pages').select('page_id, name, platform');
  const byU: Record<string, any> = {};
  for (const u of units) byU[String(u.u).toUpperCase()] = u;

  const add: Array<{ u: string; id: string; name: string; plat: string }> = [];
  const skip: Array<{ id: string; name: string; plat: string; why: string }> = [];
  for (const p of (pages || [])) {
    const id = String(p.page_id);
    if (taken.has(id)) continue;
    const u = guessUnit(String(p.name || ''));
    if (!u) { skip.push({ id, name: String(p.name || ''), plat: String(p.platform || ''), why: 'ไม่เข้ากติกาไหนเลย' }); continue; }
    if (!byU[u]) { skip.push({ id, name: String(p.name || ''), plat: String(p.platform || ''), why: `ไม่มียูนิต ${u} ในระบบ` }); continue; }
    add.push({ u, id, name: String(p.name || ''), plat: String(p.platform || '') });
  }

  add.sort((a, b) => (a.u === b.u ? a.name.localeCompare(b.name) : a.u.localeCompare(b.u)));
  console.log(`เพจทั้งหมด ${(pages || []).length} | จับคู่อยู่แล้ว ${taken.size} | จะเพิ่ม ${add.length} | ต้องจับมือ ${skip.length}`);
  console.log('--- จะเพิ่ม ---');
  for (const a of add) console.log(`  ${a.u.padEnd(5)} ${a.plat.padEnd(9)} ${a.id.padEnd(18)} ${a.name}`);
  if (skip.length) {
    console.log('--- ต้องจับมือในหน้า U Map ---');
    for (const s of skip) console.log(`  ${s.plat.padEnd(9)} ${s.id.padEnd(18)} ${s.name}  (${s.why})`);
  }

  if (!apply) { console.log('\n(ยังไม่เขียนอะไร — ใส่ --apply ถ้าถูกต้องแล้ว)'); return; }

  for (const a of add) {
    const unit = byU[a.u];
    if (!Array.isArray(unit.pages)) unit.pages = [];
    unit.pages.push({ id: a.id, name: a.name });
  }
  doc.units = units;
  doc.updatedAt = new Date().toISOString();
  const { error } = await supabase.from('sync_state').upsert(
    { key: 'u_map', value: JSON.stringify(doc), updated_at: doc.updatedAt }, { onConflict: 'key' }
  );
  if (error) throw new Error('บันทึกไม่สำเร็จ: ' + error.message);
  console.log(`\n■ บันทึกแล้ว — เพิ่ม ${add.length} เพจ`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
